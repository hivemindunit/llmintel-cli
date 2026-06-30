import type { LifecycleState } from "@llmintel/schema";
import type { ApiModel } from "./types";
import type { CheckFinding, CheckReport, ModelReference, Severity } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `now` until an ISO (YYYY-MM-DD) date; negative if already past. */
export function daysUntil(isoDate: string, now: Date): number {
  const target = new Date(`${isoDate}T00:00:00Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / DAY_MS);
}

/**
 * Build a lookup from every referenceable string (canonical id and each alias) to its model.
 * Aliases are globally unique in LLMIntel, so this never collides across models in practice;
 * if it ever did, the last write wins, which is acceptable for a best-effort resolver.
 */
export function buildIndex(models: ApiModel[]): Map<string, ApiModel> {
  const index = new Map<string, ApiModel>();
  for (const model of models) {
    index.set(model.id.toLowerCase(), model);
    for (const alias of model.aliases) {
      index.set(alias.toLowerCase(), model);
    }
  }
  return index;
}

export interface GateOptions {
  /** Warn when a non-failing model retires within this many days. */
  warnDays: number;
  /** Whether unresolved references are an error (true) or just a warning (false). */
  failOnUnknown: boolean;
  /**
   * Lifecycle states that constitute a build failure. Defaults to retired-only when omitted, which
   * matches the free gate; a paid policy may add `deprecated`/`retiring`.
   */
  failOn?: LifecycleState[];
}

/** Classify a single reference against the model index. Pure; `now` is injected for testing. */
export function evaluateReference(
  reference: ModelReference,
  index: Map<string, ApiModel>,
  options: GateOptions,
  now: Date,
): CheckFinding {
  const model = index.get(reference.value.toLowerCase()) ?? null;
  const failOn = options.failOn ?? ["retired"];

  if (!model) {
    return {
      reference,
      model: null,
      severity: options.failOnUnknown ? "error" : "unknown",
      reason: "not tracked by LLMIntel",
      daysUntilRetirement: null,
    };
  }

  const days = model.retirementDate ? daysUntil(model.retirementDate, now) : null;

  // Policy-driven failures: any state the account's policy lists as failable.
  if (failOn.includes(model.lifecycleState)) {
    const reason =
      model.lifecycleState === "retired"
        ? "retired — API calls fail"
        : `${model.lifecycleState} (policy fails on this state)`;
    return { reference, model, severity: "error", reason, daysUntilRetirement: days };
  }

  // Past-due retirement date without a retired state still warrants failing the build.
  if (days !== null && days < 0) {
    return {
      reference,
      model,
      severity: "error",
      reason: `retirement date ${model.retirementDate} has passed`,
      daysUntilRetirement: days,
    };
  }

  const within = days !== null && days <= options.warnDays;
  if (model.lifecycleState === "deprecated" || model.lifecycleState === "retiring" || within) {
    const when = days !== null ? `retires in ${days} day${days === 1 ? "" : "s"} (${model.retirementDate})` : model.lifecycleState;
    return { reference, model, severity: "warn", reason: when, daysUntilRetirement: days };
  }

  return { reference, model, severity: "ok", reason: model.lifecycleState, daysUntilRetirement: days };
}

export interface ReportOptions extends GateOptions {
  /** Treat warnings as failures (exit non-zero). */
  failOnWarn: boolean;
}

const EMPTY_COUNTS: () => Record<Severity, number> = () => ({ ok: 0, warn: 0, error: 0, unknown: 0 });

/** Evaluate all references and compute the aggregate report + exit code. */
export function buildReport(
  references: ModelReference[],
  models: ApiModel[],
  options: ReportOptions,
  now: Date = new Date(),
): CheckReport {
  const index = buildIndex(models);
  const findings = references.map((ref) => evaluateReference(ref, index, options, now));

  const counts = EMPTY_COUNTS();
  for (const finding of findings) counts[finding.severity] += 1;

  let exitCode = 0;
  if (counts.error > 0) exitCode = 1;
  else if (options.failOnWarn && counts.warn > 0) exitCode = 1;

  return { findings, counts, exitCode };
}
