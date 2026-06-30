import { describe, expect, it } from "vitest";
import { run } from "./index";
import type { ApiModel } from "./types";
import type { RemotePolicy, SyncOptions, SyncWatchesResponse } from "./client";

function model(overrides: Partial<ApiModel>): ApiModel {
  return {
    id: "openai/gpt-4o",
    provider: "openai",
    displayName: "GPT-4o",
    aliases: ["gpt-4o"],
    lifecycleState: "active",
    announcedDate: null,
    deprecatedDate: null,
    retirementDate: null,
    sourceUrl: "https://example.com",
    sourceTerm: "active",
    lastVerifiedAt: null,
    ...overrides,
  };
}

interface Captured {
  out: string[];
  err: string[];
}

function deps(argv: string[], models: ApiModel[], env: NodeJS.ProcessEnv = {}) {
  const captured: Captured = { out: [], err: [] };
  return {
    captured,
    run: () =>
      run({
        argv,
        env: { LLMINTEL_API_KEY: "test-key", ...env },
        log: (m) => captured.out.push(m),
        error: (m) => captured.err.push(m),
        fetchModels: async () => models,
        // Default policy stub = retired-only, so existing check tests behave as before.
        fetchPolicy: async () => ({
          failOn: ["retired"],
          warnWindowDays: 90,
          failOnUnknown: false,
          policyGating: false,
        }),
      }),
  };
}

describe("run", () => {
  it("exits 0 when referenced models are healthy", async () => {
    const { captured, run: invoke } = deps(["check", "--models", "gpt-4o"], [model({})]);
    expect(await invoke()).toBe(0);
    expect(captured.out.join("\n")).toContain("0 error");
  });

  it("exits 1 when a referenced model is retired", async () => {
    const { run: invoke } = deps(
      ["check", "--models", "gpt-4o"],
      [model({ lifecycleState: "retired" })],
    );
    expect(await invoke()).toBe(1);
  });

  it("emits JSON with --json", async () => {
    const { captured, run: invoke } = deps(
      ["check", "--models", "gpt-4o", "--json"],
      [model({ lifecycleState: "retired" })],
    );
    await invoke();
    const parsed = JSON.parse(captured.out.join("\n"));
    expect(parsed.exitCode).toBe(1);
    expect(parsed.findings[0].severity).toBe("error");
    expect(parsed.findings[0].modelId).toBe("openai/gpt-4o");
  });

  it("with --optimize, prints advisory suggestions without affecting the exit code", async () => {
    const captured: Captured = { out: [], err: [] };
    const code = await run({
      argv: ["check", "--models", "gpt-4o", "--optimize"],
      env: { LLMINTEL_API_KEY: "test-key" },
      log: (m) => captured.out.push(m),
      error: (m) => captured.err.push(m),
      fetchModels: async () => [model({})],
      fetchPolicy: async () => ({
        failOn: ["retired"],
        warnWindowDays: 90,
        failOnUnknown: false,
        policyGating: false,
      }),
      fetchOptimization: async () => ({
        candidates: [
          {
            candidateId: "anthropic/claude-haiku",
            candidateDisplayName: "Claude Haiku",
            candidateProvider: "anthropic",
            reasons: ["input −70%", "switch to anthropic"],
            crossProvider: true,
          },
        ],
      }),
    });
    expect(code).toBe(0);
    const out = captured.out.join("\n");
    expect(out).toContain("Optimization suggestions");
    expect(out).toContain("openai/gpt-4o → anthropic/claude-haiku");
    expect(out).toContain("switch to anthropic");
  });

  it("with --optimize and a free key (null optimization), prints no suggestions", async () => {
    const captured: Captured = { out: [], err: [] };
    const code = await run({
      argv: ["check", "--models", "gpt-4o", "--optimize"],
      env: { LLMINTEL_API_KEY: "test-key" },
      log: (m) => captured.out.push(m),
      error: (m) => captured.err.push(m),
      fetchModels: async () => [model({})],
      fetchPolicy: async () => ({
        failOn: ["retired"],
        warnWindowDays: 90,
        failOnUnknown: false,
        policyGating: false,
      }),
      fetchOptimization: async () => null,
    });
    expect(code).toBe(0);
    expect(captured.out.join("\n")).not.toContain("Optimization suggestions");
  });

  it("with --optimize, an optimization lookup error never affects the gate", async () => {
    const captured: Captured = { out: [], err: [] };
    const { ApiError } = await import("./client");
    const code = await run({
      argv: ["check", "--models", "gpt-4o", "--optimize"],
      env: { LLMINTEL_API_KEY: "test-key" },
      log: (m) => captured.out.push(m),
      error: (m) => captured.err.push(m),
      fetchModels: async () => [model({})],
      fetchPolicy: async () => ({
        failOn: ["retired"],
        warnWindowDays: 90,
        failOnUnknown: false,
        policyGating: false,
      }),
      fetchOptimization: async () => {
        throw new ApiError("boom", 500);
      },
    });
    expect(code).toBe(0);
    expect(captured.err.join("\n")).toContain("optimization lookup");
  });

  it("does not request optimization for retired/non-active referenced models", async () => {
    let called = 0;
    const captured: Captured = { out: [], err: [] };
    const code = await run({
      argv: ["check", "--models", "gpt-4o", "--optimize"],
      env: { LLMINTEL_API_KEY: "test-key" },
      log: (m) => captured.out.push(m),
      error: (m) => captured.err.push(m),
      fetchModels: async () => [model({ lifecycleState: "retired" })],
      fetchPolicy: async () => ({
        failOn: ["retired"],
        warnWindowDays: 90,
        failOnUnknown: false,
        policyGating: false,
      }),
      fetchOptimization: async () => {
        called += 1;
        return null;
      },
    });
    expect(code).toBe(1); // still fails the gate on the retired model
    expect(called).toBe(0); // never looked up optimization for a retired model
  });

  it("exits 2 when no API key is provided", async () => {
    const captured: Captured = { out: [], err: [] };
    const code = await run({
      argv: ["check", "--models", "gpt-4o"],
      env: {},
      log: (m) => captured.out.push(m),
      error: (m) => captured.err.push(m),
      fetchModels: async () => [],
    });
    expect(code).toBe(2);
    expect(captured.err.join("\n")).toContain("no API key");
  });

  it("exits 2 when nothing to check", async () => {
    const { run: invoke } = deps(["check"], []);
    expect(await invoke()).toBe(2);
  });

  it("exits 3 on API errors", async () => {
    const captured: Captured = { out: [], err: [] };
    const { ApiError } = await import("./client");
    const code = await run({
      argv: ["check", "--models", "gpt-4o"],
      env: { LLMINTEL_API_KEY: "k" },
      log: (m) => captured.out.push(m),
      error: (m) => captured.err.push(m),
      fetchModels: async () => {
        throw new ApiError("Invalid or revoked API key.", 401, "unauthorized");
      },
    });
    expect(code).toBe(3);
    expect(captured.err.join("\n")).toContain("API request failed");
  });

  it("prints help and exits 0", async () => {
    const { captured, run: invoke } = deps(["help"], []);
    expect(await invoke()).toBe(0);
    expect(captured.out.join("\n")).toContain("llmintel check");  });
});

describe("run check — central policy", () => {
  function policyDeps(
    argv: string[],
    models: ApiModel[],
    policy: RemotePolicy,
  ) {
    const captured: Captured = { out: [], err: [] };
    const policyCalls: number[] = [];
    return {
      captured,
      policyCalls,
      run: () =>
        run({
          argv,
          env: { LLMINTEL_API_KEY: "test-key" },
          log: (m) => captured.out.push(m),
          error: (m) => captured.err.push(m),
          fetchModels: async () => models,
          fetchPolicy: async () => {
            policyCalls.push(1);
            return policy;
          },
        }),
    };
  }

  it("fails on deprecated when the policy lists it", async () => {
    const { captured, run: invoke } = policyDeps(
      ["check", "--models", "gpt-4o"],
      [model({ lifecycleState: "deprecated" })],
      { failOn: ["deprecated", "retired"], warnWindowDays: 90, failOnUnknown: false, policyGating: true },
    );
    expect(await invoke()).toBe(1);
    expect(captured.out.join("\n")).toContain("policy fails on this state");
  });

  it("does not fail on deprecated under the default retired-only policy", async () => {
    const { run: invoke } = policyDeps(
      ["check", "--models", "gpt-4o"],
      [model({ lifecycleState: "deprecated" })],
      { failOn: ["retired"], warnWindowDays: 90, failOnUnknown: false, policyGating: false },
    );
    expect(await invoke()).toBe(0);
  });

  it("skips the policy fetch with --no-policy", async () => {
    const { policyCalls, run: invoke } = policyDeps(
      ["check", "--models", "gpt-4o", "--no-policy"],
      [model({ lifecycleState: "deprecated" })],
      { failOn: ["deprecated", "retired"], warnWindowDays: 90, failOnUnknown: false, policyGating: true },
    );
    expect(await invoke()).toBe(0);
    expect(policyCalls).toHaveLength(0);
  });

  it("continues with local flags when the policy fetch fails", async () => {
    const { ApiError } = await import("./client");
    const captured: Captured = { out: [], err: [] };
    const code = await run({
      argv: ["check", "--models", "gpt-4o"],
      env: { LLMINTEL_API_KEY: "k" },
      log: (m) => captured.out.push(m),
      error: (m) => captured.err.push(m),
      fetchModels: async () => [model({ lifecycleState: "active" })],
      fetchPolicy: async () => {
        throw new ApiError("not found", 404, "not_found");
      },
    });
    expect(code).toBe(0);
    expect(captured.err.join("\n")).toContain("could not fetch account policy");
  });
});

describe("run sync", () => {
  function syncDeps(
    argv: string[],
    syncImpl: (options: SyncOptions) => Promise<SyncWatchesResponse>,
  ) {
    const captured: Captured = { out: [], err: [] };
    const calls: SyncOptions[] = [];
    return {
      captured,
      calls,
      run: () =>
        run({
          argv,
          env: { LLMINTEL_API_KEY: "test-key" },
          log: (m) => captured.out.push(m),
          error: (m) => captured.err.push(m),
          syncWatches: async (options) => {
            calls.push(options);
            return syncImpl(options);
          },
        }),
    };
  }

  it("sends discovered models and reports the diff", async () => {
    const { captured, calls, run: invoke } = syncDeps(
      ["sync", "--models", "gpt-4o,claude-3-opus-20240229"],
      async () => ({
        added: ["openai/gpt-4o"],
        removed: ["anthropic/old"],
        unchanged: ["anthropic/claude-3-opus-20240229"],
        unresolved: [],
      }),
    );
    expect(await invoke()).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.models.sort()).toEqual(["claude-3-opus-20240229", "gpt-4o"]);
    expect(calls[0]!.prune).toBe(true);
    const out = captured.out.join("\n");
    expect(out).toContain("+ openai/gpt-4o");
    expect(out).toContain("- anthropic/old");
    expect(out).toContain("1 added, 1 removed");
  });

  it("passes --no-prune through to the client", async () => {
    const { calls, run: invoke } = syncDeps(["sync", "--models", "gpt-4o", "--no-prune"], async () => ({
      added: ["openai/gpt-4o"],
      removed: [],
      unchanged: [],
      unresolved: [],
    }));
    expect(await invoke()).toBe(0);
    expect(calls[0]!.prune).toBe(false);
  });

  it("does not call the server on --dry-run", async () => {
    const { captured, calls, run: invoke } = syncDeps(
      ["sync", "--models", "gpt-4o", "--dry-run"],
      async () => {
        throw new Error("should not be called");
      },
    );
    expect(await invoke()).toBe(0);
    expect(calls).toHaveLength(0);
    expect(captured.out.join("\n")).toContain("Would sync");
  });

  it("emits JSON for sync with --json", async () => {
    const { captured, run: invoke } = syncDeps(["sync", "--models", "gpt-4o", "--json"], async () => ({
      added: ["openai/gpt-4o"],
      removed: [],
      unchanged: [],
      unresolved: ["nope"],
    }));
    await invoke();
    const parsed = JSON.parse(captured.out.join("\n"));
    expect(parsed.added).toEqual(["openai/gpt-4o"]);
    expect(parsed.unresolved).toEqual(["nope"]);
    expect(parsed.dryRun).toBe(false);
  });

  it("exits 3 when the sync API errors", async () => {
    const { ApiError } = await import("./client");
    const { captured, run: invoke } = syncDeps(["sync", "--models", "gpt-4o"], async () => {
      throw new ApiError("Tier \"free\" does not include auto-watch.", 402, "payment_required");
    });
    expect(await invoke()).toBe(3);
    expect(captured.err.join("\n")).toContain("API request failed");
  });
});
