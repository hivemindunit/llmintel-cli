import { describe, expect, it } from "vitest";
import { buildIndex, buildReport, daysUntil, evaluateReference } from "./gate";
import type { ApiModel, ModelReference } from "./types";

const NOW = new Date("2026-06-24T00:00:00Z");

function model(overrides: Partial<ApiModel>): ApiModel {
  return {
    id: "openai/gpt-4o",
    provider: "openai",
    displayName: "GPT-4o",
    aliases: ["gpt-4o", "gpt-4o-2024-08-06"],
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

const GATE = { warnDays: 90, failOnUnknown: false };
const ref = (value: string): ModelReference => ({ value, source: "test" });

describe("daysUntil", () => {
  it("computes whole days, negative for past dates", () => {
    expect(daysUntil("2026-07-04", NOW)).toBe(10);
    expect(daysUntil("2026-06-24", NOW)).toBe(0);
    expect(daysUntil("2026-06-14", NOW)).toBe(-10);
  });
});

describe("buildIndex", () => {
  it("indexes by canonical id and every alias, lowercased", () => {
    const index = buildIndex([model({})]);
    expect(index.get("openai/gpt-4o")?.id).toBe("openai/gpt-4o");
    expect(index.get("gpt-4o")?.id).toBe("openai/gpt-4o");
    expect(index.get("gpt-4o-2024-08-06")?.id).toBe("openai/gpt-4o");
  });
});

describe("evaluateReference", () => {
  const index = buildIndex([
    model({ id: "openai/active", aliases: ["active-x"], lifecycleState: "active" }),
    model({ id: "openai/retired", aliases: ["retired-x"], lifecycleState: "retired" }),
    model({ id: "openai/dep", aliases: ["dep-x"], lifecycleState: "deprecated" }),
    model({
      id: "openai/soon",
      aliases: ["soon-x"],
      lifecycleState: "legacy",
      retirementDate: "2026-07-04",
    }),
    model({
      id: "openai/far",
      aliases: ["far-x"],
      lifecycleState: "legacy",
      retirementDate: "2027-01-01",
    }),
    model({
      id: "openai/pastdue",
      aliases: ["pastdue-x"],
      lifecycleState: "retiring",
      retirementDate: "2026-06-01",
    }),
  ]);

  it("passes healthy active models", () => {
    expect(evaluateReference(ref("active-x"), index, GATE, NOW).severity).toBe("ok");
  });

  it("fails retired models", () => {
    expect(evaluateReference(ref("retired-x"), index, GATE, NOW).severity).toBe("error");
  });

  it("warns deprecated models", () => {
    expect(evaluateReference(ref("dep-x"), index, GATE, NOW).severity).toBe("warn");
  });

  it("warns models retiring within the warn window", () => {
    const finding = evaluateReference(ref("soon-x"), index, GATE, NOW);
    expect(finding.severity).toBe("warn");
    expect(finding.daysUntilRetirement).toBe(10);
  });

  it("passes legacy models retiring beyond the warn window", () => {
    expect(evaluateReference(ref("far-x"), index, GATE, NOW).severity).toBe("ok");
  });

  it("fails models whose retirement date has passed even if not marked retired", () => {
    expect(evaluateReference(ref("pastdue-x"), index, GATE, NOW).severity).toBe("error");
  });

  it("resolves references case-insensitively", () => {
    expect(evaluateReference(ref("ACTIVE-X"), index, GATE, NOW).severity).toBe("ok");
  });

  it("reports unknown references as unknown by default and error when failOnUnknown", () => {
    expect(evaluateReference(ref("mystery-9"), index, GATE, NOW).severity).toBe("unknown");
    expect(
      evaluateReference(ref("mystery-9"), index, { ...GATE, failOnUnknown: true }, NOW).severity,
    ).toBe("error");
  });
});

describe("buildReport", () => {
  const models = [
    model({ id: "openai/active", aliases: ["active-x"], lifecycleState: "active" }),
    model({ id: "openai/retired", aliases: ["retired-x"], lifecycleState: "retired" }),
    model({ id: "openai/dep", aliases: ["dep-x"], lifecycleState: "deprecated" }),
  ];

  it("exits 0 when all healthy", () => {
    const report = buildReport([ref("active-x")], models, { ...GATE, failOnWarn: false }, NOW);
    expect(report.exitCode).toBe(0);
  });

  it("exits 1 when any error present", () => {
    const report = buildReport(
      [ref("active-x"), ref("retired-x")],
      models,
      { ...GATE, failOnWarn: false },
      NOW,
    );
    expect(report.exitCode).toBe(1);
    expect(report.counts.error).toBe(1);
  });

  it("exits 0 on warnings unless failOnWarn is set", () => {
    const opts = { ...GATE, failOnWarn: false };
    expect(buildReport([ref("dep-x")], models, opts, NOW).exitCode).toBe(0);
    expect(buildReport([ref("dep-x")], models, { ...opts, failOnWarn: true }, NOW).exitCode).toBe(1);
  });
});
