import type { LifecycleState, Provider } from "@llmintel/schema";

/** The public `GET /v1/models` item shape (mirrors apps/web serializeModel). */
export interface ApiModel {
  id: string;
  provider: Provider;
  displayName: string;
  aliases: string[];
  lifecycleState: LifecycleState;
  announcedDate: string | null;
  deprecatedDate: string | null;
  retirementDate: string | null;
  sourceUrl: string;
  sourceTerm: string;
  lastVerifiedAt: string | null;
}

export interface ApiListResponse {
  data: ApiModel[];
  count: number;
}

/** A model reference discovered in the user's code/config. */
export interface ModelReference {
  /** The verbatim string referenced (e.g. "gpt-4o"). */
  value: string;
  /** Where it was found, for reporting (file path or "--models"). */
  source: string;
}

export type Severity = "ok" | "warn" | "error" | "unknown";

/** The result of evaluating a single reference against the lifecycle data. */
export interface CheckFinding {
  reference: ModelReference;
  /** Matched canonical model, if the reference resolved. */
  model: ApiModel | null;
  severity: Severity;
  /** Human-readable explanation, e.g. "retired" or "retires in 12 days". */
  reason: string;
  /** Days until retirement when known and in the future; null otherwise. */
  daysUntilRetirement: number | null;
}

export interface CheckReport {
  findings: CheckFinding[];
  counts: Record<Severity, number>;
  /** Process exit code implied by the findings + options. */
  exitCode: number;
}

/** A single advisory "you could switch to…" suggestion for a referenced model. */
export interface OptimizationNudge {
  /** The referenced (current) model id. */
  modelId: string;
  candidateId: string;
  candidateDisplayName: string;
  candidateProvider: Provider;
  /** Human-readable, checkable reasons, e.g. ["input −80%", "context 2×", "switch to anthropic"]. */
  reasons: string[];
  /** True when adopting the candidate means switching provider (extra migration effort). */
  crossProvider: boolean;
}

/** Shape of the `optimization` payload returned by `GET /v1/models/{id}` (paid keys). */
export interface ApiOptimization {
  candidates: Array<{
    candidateId: string;
    candidateDisplayName: string;
    candidateProvider: Provider;
    reasons: string[];
    crossProvider: boolean;
  }>;
}
