import type { ModelReference } from "./types";

/**
 * Heuristic to find model-like tokens in arbitrary source/config text. Models are referenced as
 * string literals (`"gpt-4o"`, `'claude-opus-4-1'`, `model: gpt-4o`). We extract quoted strings
 * and bare tokens that look like model ids, then let the resolver decide which are real models —
 * so unknown matches are cheap and harmless (reported as `unknown`, not failures by default).
 */
const QUOTED = /['"`]([A-Za-z0-9][A-Za-z0-9._/-]{2,80})['"`]/g;

/** Looks like a model id: has a digit and a hyphen or slash, and isn't an obvious path/url. */
function looksLikeModel(token: string): boolean {
  if (!/\d/.test(token)) return false;
  if (!/[-/]/.test(token)) return false;
  if (token.includes("://") || token.startsWith("/") || token.includes("\\")) return false;
  if (/\.(js|ts|tsx|jsx|json|py|go|rb|java|css|html|md|png|svg|lock)$/i.test(token)) return false;
  return true;
}

/** Extract candidate model references from a blob of text. */
export function extractReferences(text: string, source: string): ModelReference[] {
  const found = new Map<string, ModelReference>();
  for (const match of text.matchAll(QUOTED)) {
    const token = match[1];
    if (token && looksLikeModel(token) && !found.has(token)) {
      found.set(token, { value: token, source });
    }
  }
  return [...found.values()];
}

/** Merge reference lists, de-duplicating by value (keeping the first source seen). */
export function dedupeReferences(lists: ModelReference[][]): ModelReference[] {
  const seen = new Map<string, ModelReference>();
  for (const list of lists) {
    for (const ref of list) {
      if (!seen.has(ref.value)) seen.set(ref.value, ref);
    }
  }
  return [...seen.values()];
}
