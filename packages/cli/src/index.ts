#!/usr/bin/env node
/**
 * `llmintel check` — CI/CD lifecycle gating.
 *
 * Scans a codebase/config for referenced model ids, queries the LLMIntel API for their lifecycle
 * state, and exits non-zero when any referenced model is retired (or past its retirement date),
 * suitable for failing a CI build. Deprecated/retiring or soon-to-retire models warn by default.
 */

import { fetchAllModels, fetchOptimization, fetchPolicy, syncWatches, type ClientOptions, type RemotePolicy, type SyncOptions, type SyncWatchesResponse } from "./client";
import { ApiError } from "./client";
import { loadConfig, ConfigError } from "./config";
import { dedupeReferences } from "./extract";
import { buildIndex, buildReport } from "./gate";
import { formatHuman, formatJson, formatOptimization } from "./report";
import { scanPaths } from "./scan";
import { formatSyncHuman, formatSyncJson } from "./sync";
import { HELP_TEXT, parseArgs, UsageError, type CliOptions } from "./args";
import type { ApiModel, ModelReference, OptimizationNudge } from "./types";
import type { LifecycleState } from "@llmintel/schema";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_API = 3;

const VERSION = "0.1.1";

interface Deps {
  argv: string[];
  env: NodeJS.ProcessEnv;
  log: (msg: string) => void;
  error: (msg: string) => void;
  fetchModels?: (options: ClientOptions) => Promise<ApiModel[]>;
  syncWatches?: (options: SyncOptions) => Promise<SyncWatchesResponse>;
  fetchPolicy?: (options: ClientOptions) => Promise<RemotePolicy>;
  fetchOptimization?: typeof fetchOptimization;
}

interface ResolvedConfig {
  paths: string[];
  models: string[];
  warnDays: number;
  apiUrl: string;
}

/** Merge a `--config` file (if any) into the parsed CLI options. */
async function mergeConfig(options: CliOptions, env: NodeJS.ProcessEnv): Promise<ResolvedConfig> {
  let paths = options.paths;
  let models = options.models;
  let warnDays = options.warnDays;
  let apiUrl = options.apiUrl;
  if (options.config) {
    const config = await loadConfig(options.config);
    if (config.models) models = [...models, ...config.models];
    if (config.paths) paths = [...paths, ...config.paths];
    if (config.warnDays !== undefined && options.warnDays === 90) warnDays = config.warnDays;
    if (config.apiUrl && env.LLMINTEL_API_URL === undefined) apiUrl = config.apiUrl;
  }
  return { paths, models, warnDays, apiUrl };
}

/** Gather references from explicit --models plus anything discovered by scanning paths. */
async function gatherReferences(models: string[], paths: string[]): Promise<ModelReference[]> {
  const explicit: ModelReference[] = models.map((value) => ({ value, source: "--models" }));
  const scanned = paths.length > 0 ? await scanPaths(paths) : [];
  return dedupeReferences([explicit, scanned]);
}

/** Core orchestration. Returns the process exit code; all I/O goes through `deps`. */
export async function run(deps: Deps): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(deps.argv, deps.env);
  } catch (cause) {
    if (cause instanceof UsageError) {
      deps.error(`error: ${cause.message}\n`);
      deps.error(HELP_TEXT);
      return EXIT_USAGE;
    }
    throw cause;
  }

  if (options.command === "help") {
    deps.log(HELP_TEXT);
    return EXIT_OK;
  }
  if (options.command === "version") {
    deps.log(VERSION);
    return EXIT_OK;
  }

  let config: ResolvedConfig;
  try {
    config = await mergeConfig(options, deps.env);
  } catch (cause) {
    if (cause instanceof ConfigError) {
      deps.error(`error: ${cause.message}`);
      return EXIT_USAGE;
    }
    throw cause;
  }

  if (!options.apiKey) {
    deps.error("error: no API key. Pass --api-key or set LLMINTEL_API_KEY.");
    return EXIT_USAGE;
  }
  if (config.models.length === 0 && config.paths.length === 0) {
    deps.error("error: nothing to check. Pass file paths and/or --models.");
    deps.error(HELP_TEXT);
    return EXIT_USAGE;
  }

  const references = await gatherReferences(config.models, config.paths);
  if (references.length === 0) {
    deps.error("error: no model references found in the given paths.");
    return EXIT_USAGE;
  }

  if (options.command === "sync") {
    return runSync(deps, options, config, references);
  }
  return runCheck(deps, options, config, references);
}

/** `check`: classify references against lifecycle data and exit non-zero on errors. */
async function runCheck(
  deps: Deps,
  options: CliOptions,
  config: ResolvedConfig,
  references: ModelReference[],
): Promise<number> {
  const fetchModels = deps.fetchModels ?? fetchAllModels;
  let apiModels: ApiModel[];
  try {
    apiModels = await fetchModels({ baseUrl: config.apiUrl, apiKey: options.apiKey! });
  } catch (cause) {
    if (cause instanceof ApiError) {
      deps.error(`error: API request failed: ${cause.message}`);
      return EXIT_API;
    }
    throw cause;
  }

  // Apply the account's central gate policy as the baseline; explicit local flags override it.
  // Best-effort: a missing/legacy endpoint or non-account key falls back to local-only behavior.
  let warnDays = config.warnDays;
  let failOnUnknown = options.failOnUnknown;
  let failOn: LifecycleState[] = ["retired"];

  if (options.usePolicy) {
    const getPolicy = deps.fetchPolicy ?? fetchPolicy;
    try {
      const policy = await getPolicy({ baseUrl: config.apiUrl, apiKey: options.apiKey! });
      failOn = policy.failOn.filter((s): s is LifecycleState =>
        ["announced", "active", "legacy", "deprecated", "retiring", "retired"].includes(s),
      );
      if (failOn.length === 0) failOn = ["retired"];
      if (!options.explicit.warnDays) warnDays = policy.warnWindowDays;
      if (!options.explicit.failOnUnknown) failOnUnknown = policy.failOnUnknown;
    } catch (cause) {
      if (!options.quiet) {
        const detail = cause instanceof ApiError ? cause.message : String(cause);
        deps.error(`note: could not fetch account policy (${detail}); using local flags only.`);
      }
    }
  }

  const report = buildReport(references, apiModels, {
    warnDays,
    failOnWarn: options.failOnWarn,
    failOnUnknown,
    failOn,
  });

  // Advisory optimization nudges (opt-in via --optimize). Best-effort and never affects the exit
  // code: we look up "you could switch to…" candidates for the resolved, non-failing models the user
  // actually references. Paid-gated server-side; a free key or any per-model error simply yields no
  // nudges. We cap the number of lookups to keep CI fast and avoid hammering the API.
  let nudges: OptimizationNudge[] = [];
  if (options.optimize) {
    nudges = await gatherOptimizations(deps, options, config, references, apiModels);
  }

  if (options.json) {
    deps.log(formatJson(report, nudges));
  } else {
    deps.log(formatHuman(report, options.quiet));
    const opt = formatOptimization(nudges);
    if (opt) deps.log(opt);
  }
  return report.exitCode;
}

/** Max distinct models we'll request optimization candidates for, to bound CI latency/cost. */
const MAX_OPTIMIZE_LOOKUPS = 25;

/**
 * Best-effort gather of advisory optimization candidates for the referenced models. Resolves each
 * reference to its canonical model (via the same index the gate uses), keeps only *active* ones
 * (retired/deprecated models are a gate concern, not an optimization one), de-duplicates, caps the
 * count, and fetches candidates per model. Any error is swallowed (optionally noted when not quiet)
 * so optimization can never break or slow a build beyond the cap.
 */
async function gatherOptimizations(
  deps: Deps,
  options: CliOptions,
  config: ResolvedConfig,
  references: ModelReference[],
  apiModels: ApiModel[],
): Promise<OptimizationNudge[]> {
  const getOptimization = deps.fetchOptimization ?? fetchOptimization;
  const index = buildIndex(apiModels);

  const activeIds: string[] = [];
  const seen = new Set<string>();
  for (const ref of references) {
    const model = index.get(ref.value.toLowerCase());
    if (!model || model.lifecycleState !== "active") continue;
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    activeIds.push(model.id);
    if (activeIds.length >= MAX_OPTIMIZE_LOOKUPS) break;
  }

  const nudges: OptimizationNudge[] = [];
  for (const modelId of activeIds) {
    try {
      const optimization = await getOptimization({
        baseUrl: config.apiUrl,
        apiKey: options.apiKey!,
        modelId,
      });
      if (!optimization) continue; // free key (null) or no candidates
      for (const c of optimization.candidates) {
        nudges.push({
          modelId,
          candidateId: c.candidateId,
          candidateDisplayName: c.candidateDisplayName,
          candidateProvider: c.candidateProvider,
          reasons: c.reasons,
          crossProvider: c.crossProvider,
        });
      }
    } catch (cause) {
      if (!options.quiet) {
        const detail = cause instanceof ApiError ? cause.message : String(cause);
        deps.error(`note: optimization lookup for ${modelId} failed (${detail}); skipping.`);
      }
    }
  }
  return nudges;
}

/** `sync`: register the discovered footprint as the account's watched set (or preview with --dry-run). */
async function runSync(
  deps: Deps,
  options: CliOptions,
  config: ResolvedConfig,
  references: ModelReference[],
): Promise<number> {
  const sync = deps.syncWatches ?? syncWatches;
  const discovered = [...new Set(references.map((r) => r.value))];

  // --dry-run never mutates and never calls the server (resolution is server-side, so we cannot
  // produce a real diff offline). Echo the discovered references as the set that would be synced.
  if (options.dryRun) {
    const summary = {
      added: discovered.sort(),
      removed: [],
      unchanged: [],
      unresolved: [],
      dryRun: true,
      discovered: discovered.length,
    };
    deps.log(options.json ? formatSyncJson(summary) : formatSyncHuman(summary, options.quiet));
    return EXIT_OK;
  }

  let result: SyncWatchesResponse;
  try {
    result = await sync({
      baseUrl: config.apiUrl,
      apiKey: options.apiKey!,
      models: discovered,
      prune: options.prune,
    });
  } catch (cause) {
    if (cause instanceof ApiError) {
      deps.error(`error: API request failed: ${cause.message}`);
      return EXIT_API;
    }
    throw cause;
  }

  const summary = { ...result, dryRun: false, discovered: discovered.length };
  deps.log(options.json ? formatSyncJson(summary) : formatSyncHuman(summary, options.quiet));
  return EXIT_OK;
}

async function main(): Promise<void> {
  const code = await run({
    argv: process.argv.slice(2),
    env: process.env,
    log: (msg) => process.stdout.write(`${msg}\n`),
    error: (msg) => process.stderr.write(`${msg}\n`),
  });
  process.exit(code);
}

// Auto-run when this module is the process entrypoint, but not when imported (e.g. by tests).
// Node resolves symlinks for the ESM entrypoint, so `import.meta.url` is the real file path while
// `process.argv[1]` is whatever was launched — which for an npm/npx bin is a *symlink* in
// node_modules/.bin (e.g. `.bin/llmintel`). Comparing the raw argv path (or matching it against a
// /index\.js$/ regex) therefore misses, and `main()` never runs: that's why the published CLI
// silently exited 0 with no output under `npx @llmintel/cli`. Resolve argv[1] via realpath before
// comparing so direct, symlinked, and npx invocations all run.
const isEntrypoint = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
})();
if (isEntrypoint) {
  void main();
}
