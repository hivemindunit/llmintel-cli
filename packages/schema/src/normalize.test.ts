import { describe, expect, it } from "vitest";
import {
  UnmappedLifecycleTermError,
  normalizeDate,
  normalizeLifecycle,
  toCanonicalSlug,
  tryNormalizeLifecycle,
} from "./normalize";

describe("normalizeLifecycle", () => {
  it("maps OpenAI vocabulary onto canonical states", () => {
    expect(normalizeLifecycle("openai", "deprecated")).toBe("deprecated");
    expect(normalizeLifecycle("openai", "Shutdown")).toBe("retired");
    expect(normalizeLifecycle("openai", "shut down")).toBe("retired");
  });

  it("maps Anthropic's four-state vocabulary", () => {
    expect(normalizeLifecycle("anthropic", "Active")).toBe("active");
    expect(normalizeLifecycle("anthropic", "Legacy")).toBe("legacy");
    expect(normalizeLifecycle("anthropic", "Deprecated")).toBe("deprecated");
    expect(normalizeLifecycle("anthropic", "Retired")).toBe("retired");
  });

  it("fails loud on unknown terms", () => {
    expect(() => normalizeLifecycle("openai", "vibing")).toThrow(UnmappedLifecycleTermError);
    expect(tryNormalizeLifecycle("openai", "vibing")).toBeNull();
  });
});

describe("toCanonicalSlug", () => {
  it("produces a stable provider-prefixed slug", () => {
    expect(toCanonicalSlug("anthropic", "Claude Opus 4.1")).toBe("anthropic/claude-opus-4.1");
    expect(toCanonicalSlug("openai", "gpt-4-32k")).toBe("openai/gpt-4-32k");
  });
});

describe("normalizeDate", () => {
  it("passes through valid ISO dates", () => {
    expect(normalizeDate("2026-04-14")).toBe("2026-04-14");
    expect(normalizeDate("  2026-04-14  ")).toBe("2026-04-14");
  });

  it("rejects ISO strings that are not real calendar dates", () => {
    expect(normalizeDate("2026-13-01")).toBeNull();
    expect(normalizeDate("2026-02-30")).toBeNull();
    expect(normalizeDate("2026-00-10")).toBeNull();
  });

  it("parses month-name formats in either order without timezone drift", () => {
    expect(normalizeDate("April 14, 2026")).toBe("2026-04-14");
    expect(normalizeDate("Apr 14 2026")).toBe("2026-04-14");
    expect(normalizeDate("14 April 2026")).toBe("2026-04-14");
    expect(normalizeDate("September 1, 2026")).toBe("2026-09-01");
    expect(normalizeDate("Jan 5, 2027")).toBe("2027-01-05");
  });

  it("parses numeric slash/dot forms when the year is unambiguous", () => {
    expect(normalizeDate("4/14/2026")).toBe("2026-04-14");
    expect(normalizeDate("2026/4/14")).toBe("2026-04-14");
    expect(normalizeDate("2026.09.24")).toBe("2026-09-24");
  });

  it("strips trailing parentheticals and footnote markers", () => {
    expect(normalizeDate("2026-09-24 (tentative)")).toBe("2026-09-24");
    expect(normalizeDate("April 14, 2026*")).toBe("2026-04-14");
    expect(normalizeDate("2026-06-15 †")).toBe("2026-06-15");
  });

  it("refuses partial, ambiguous, or sentinel dates rather than guessing", () => {
    expect(normalizeDate("2026")).toBeNull();
    expect(normalizeDate("April 2026")).toBeNull();
    expect(normalizeDate("Q3 2026")).toBeNull();
    expect(normalizeDate("TBD")).toBeNull();
    expect(normalizeDate("N/A")).toBeNull();
    expect(normalizeDate("4/14/26")).toBeNull(); // two-digit year is ambiguous
    expect(normalizeDate("2025-2026")).toBeNull(); // range
  });

  it("returns null for empty or unparseable input", () => {
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate("not a date")).toBeNull();
  });
});
