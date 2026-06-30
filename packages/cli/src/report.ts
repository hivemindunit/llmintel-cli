import type { CheckReport, OptimizationNudge, Severity } from "./types";

const SYMBOLS: Record<Severity, string> = {
  ok: "ok   ",
  warn: "WARN ",
  error: "FAIL ",
  unknown: "?    ",
};

/** Render a human-readable report. `quiet` hides healthy/unknown rows. */
export function formatHuman(report: CheckReport, quiet: boolean): string {
  const lines: string[] = [];
  const rows = report.findings.filter((f) => (quiet ? f.severity === "error" || f.severity === "warn" : true));

  for (const finding of rows) {
    const id = finding.model?.id ?? finding.reference.value;
    lines.push(`  ${SYMBOLS[finding.severity]} ${id} — ${finding.reason}  [${finding.reference.source}]`);
  }

  if (lines.length > 0) lines.push("");
  lines.push(
    `Checked ${report.findings.length} reference(s): ` +
      `${report.counts.error} error, ${report.counts.warn} warn, ` +
      `${report.counts.unknown} unknown, ${report.counts.ok} ok.`,
  );
  return lines.join("\n");
}

/** Render a stable JSON report for machine consumption. */
export function formatJson(report: CheckReport, optimizations: OptimizationNudge[] = []): string {
  return JSON.stringify(
    {
      exitCode: report.exitCode,
      counts: report.counts,
      findings: report.findings.map((f) => ({
        reference: f.reference.value,
        source: f.reference.source,
        modelId: f.model?.id ?? null,
        provider: f.model?.provider ?? null,
        lifecycleState: f.model?.lifecycleState ?? null,
        retirementDate: f.model?.retirementDate ?? null,
        daysUntilRetirement: f.daysUntilRetirement,
        severity: f.severity,
        reason: f.reason,
      })),
      optimizations: optimizations.map((o) => ({
        modelId: o.modelId,
        candidateId: o.candidateId,
        candidateProvider: o.candidateProvider,
        reasons: o.reasons,
        crossProvider: o.crossProvider,
      })),
    },
    null,
    2,
  );
}

/**
 * Render the advisory optimization block for human output. This is purely informational — it never
 * changes the exit code — so it is clearly labelled and printed after the gate summary.
 */
export function formatOptimization(optimizations: OptimizationNudge[]): string {
  if (optimizations.length === 0) return "";
  const lines: string[] = ["", "Optimization suggestions (advisory — does not affect the build):"];
  for (const o of optimizations) {
    const switchNote = o.crossProvider ? ` (switch to ${o.candidateProvider})` : "";
    lines.push(`  ~ ${o.modelId} → ${o.candidateId}${switchNote}: ${o.reasons.join(", ")}`);
  }
  return lines.join("\n");
}
