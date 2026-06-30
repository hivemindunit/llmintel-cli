import { describe, expect, it } from "vitest";
import { extractReferences, dedupeReferences } from "./extract";

describe("extractReferences", () => {
  it("finds quoted model-like tokens and ignores plain words/paths/urls", () => {
    const text = `
      const model = "gpt-4o-2024-08-06";
      client.create({ model: 'claude-opus-4-1' });
      import x from "./helpers";
      const url = "https://example.com/v1";
      const note = "just some prose here";
      const file = "styles.css";
    `;
    const refs = extractReferences(text, "a.ts").map((r) => r.value).sort();
    expect(refs).toEqual(["claude-opus-4-1", "gpt-4o-2024-08-06"]);
  });

  it("requires a digit and a separator to reduce false positives", () => {
    expect(extractReferences(`"hello-world"`, "x")).toHaveLength(0); // no digit
    expect(extractReferences(`"gpt4o"`, "x")).toHaveLength(0); // no separator
    expect(extractReferences(`"gpt-4o"`, "x")).toHaveLength(1);
  });

  it("dedupes by value across files, keeping first source", () => {
    const a = extractReferences(`"gpt-4o"`, "a.ts");
    const b = extractReferences(`"gpt-4o"`, "b.ts");
    const merged = dedupeReferences([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("a.ts");
  });
});
