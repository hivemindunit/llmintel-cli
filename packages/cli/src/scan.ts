import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { extractReferences } from "./extract";
import type { ModelReference } from "./types";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel",
  "vendor",
  "__pycache__",
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Recursively collect references from a file or directory path. Best-effort: unreadable entries are skipped. */
export async function scanPath(path: string): Promise<ModelReference[]> {
  let info;
  try {
    info = await stat(path);
  } catch {
    return [];
  }

  if (info.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    const results = await Promise.all(
      entries.map((entry) => {
        if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) return Promise.resolve([]);
        return scanPath(join(path, entry.name));
      }),
    );
    return results.flat();
  }

  if (info.size > MAX_FILE_BYTES) return [];
  try {
    const text = await readFile(path, "utf8");
    return extractReferences(text, path);
  } catch {
    return [];
  }
}

/** Scan every provided path and merge the discovered references. */
export async function scanPaths(paths: string[]): Promise<ModelReference[]> {
  const lists = await Promise.all(paths.map(scanPath));
  return lists.flat();
}
