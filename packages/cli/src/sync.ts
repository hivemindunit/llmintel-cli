import type { SyncWatchesResponse } from "./client";

export interface SyncSummary extends SyncWatchesResponse {
  /** Whether the call was a dry run (no changes were written). */
  dryRun: boolean;
  /** Total references discovered (resolved + unresolved). */
  discovered: number;
}

/** Render a human-readable summary of a sync result. */
export function formatSyncHuman(summary: SyncSummary, quiet: boolean): string {
  const lines: string[] = [];
  const prefix = summary.dryRun ? "Would" : "Did";

  if (!quiet) {
    for (const id of summary.added) lines.push(`  + ${id}`);
    for (const id of summary.removed) lines.push(`  - ${id}`);
  }
  for (const ref of summary.unresolved) lines.push(`  ? ${ref} — not tracked by LLMIntel`);

  if (lines.length > 0) lines.push("");
  lines.push(
    `${prefix} sync ${summary.discovered} discovered reference(s): ` +
      `${summary.added.length} added, ${summary.removed.length} removed, ` +
      `${summary.unchanged.length} unchanged, ${summary.unresolved.length} unresolved.`,
  );
  return lines.join("\n");
}

/** Render a stable JSON summary for machine consumption. */
export function formatSyncJson(summary: SyncSummary): string {
  return JSON.stringify(
    {
      dryRun: summary.dryRun,
      discovered: summary.discovered,
      added: summary.added,
      removed: summary.removed,
      unchanged: summary.unchanged,
      unresolved: summary.unresolved,
    },
    null,
    2,
  );
}
