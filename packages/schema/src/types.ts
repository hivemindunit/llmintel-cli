import { z } from "zod";
import { LIFECYCLE_STATES } from "./lifecycle";
import { PROVIDERS } from "./providers";

export const providerSchema = z.enum(PROVIDERS);
export const lifecycleStateSchema = z.enum(LIFECYCLE_STATES);

/** Distinguishes hard provider-stated facts from LLMIntel's editorial recommendations. */
export const confidenceSchema = z.enum(["provider_stated", "editorial"]);
export type Confidence = z.infer<typeof confidenceSchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .nullable();

/** A tracked model and its current canonical lifecycle state. */
export const modelSchema = z.object({
  id: z.string().min(1),
  provider: providerSchema,
  displayName: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  lifecycleState: lifecycleStateSchema,
  announcedDate: isoDate.default(null),
  deprecatedDate: isoDate.default(null),
  retirementDate: isoDate.default(null),
  sourceUrl: z.string().url(),
  sourceTerm: z.string().min(1),
  lastVerifiedAt: z.string().datetime().nullable().default(null),
});
export type Model = z.infer<typeof modelSchema>;

/** Structured pricing change between an outgoing model and its replacement (USD per 1M tokens). */
export const pricingDeltaSchema = z.object({
  inputUsdPerMillion: z.number().nullable().default(null),
  outputUsdPerMillion: z.number().nullable().default(null),
});
export type PricingDelta = z.infer<typeof pricingDeltaSchema>;

/**
 * Quantitative capability/cost facts for a model, used to compute migration intelligence
 * (pricing and context-window deltas vs. a recommended replacement). Pricing is USD per 1M tokens.
 * Specs are curated/editorial: providers rarely publish them on the same page as deprecations.
 */
export const modelSpecSchema = z.object({
  modelId: z.string().min(1),
  inputUsdPerMillion: z.number().nonnegative().nullable().default(null),
  outputUsdPerMillion: z.number().nonnegative().nullable().default(null),
  contextWindowTokens: z.number().int().positive().nullable().default(null),
  maxOutputTokens: z.number().int().positive().nullable().default(null),
  /** Where the figures came from (provider pricing page URL or a short note). */
  source: z.string().nullable().default(null),
});
export type ModelSpec = z.infer<typeof modelSpecSchema>;

/**
 * Benchmark-derived performance facts for a model. Kept separate from the hand-curated `ModelSpec`
 * because these are populated automatically by the benchmark collector (Artificial Analysis), not
 * by the editorial seed. `intelligenceIndex` and component `benchmarks` are stored privately and
 * never republished raw — only the derived `capabilityClass` and speed metrics are surfaced.
 */
export const modelBenchmarkSchema = z.object({
  modelId: z.string().min(1),
  capabilityClass: z.enum(["flagship", "balanced", "lite"]).nullable().default(null),
  intelligenceIndex: z.number().nullable().default(null),
  tokensPerSecond: z.number().nonnegative().nullable().default(null),
  timeToFirstTokenSeconds: z.number().nonnegative().nullable().default(null),
  benchmarks: z.record(z.string(), z.number()).nullable().default(null),
  benchmarkSource: z.string().nullable().default(null),
});
export type ModelBenchmark = z.infer<typeof modelBenchmarkSchema>;

/** Editorial capability tier within a provider family, benchmark-derived. */
export const capabilityClassSchema = z.enum(["flagship", "balanced", "lite"]);
export type CapabilityClass = z.infer<typeof capabilityClassSchema>;

/** Actionable migration payload attached to a model. */
export const migrationRecommendationSchema = z.object({
  modelId: z.string().min(1),
  recommendedReplacementIds: z.array(z.string()).default([]),
  pricingDelta: pricingDeltaSchema.nullable().default(null),
  contextWindowDelta: z.number().int().nullable().default(null),
  breakingNotes: z.string().nullable().default(null),
  confidence: confidenceSchema,
});
export type MigrationRecommendation = z.infer<typeof migrationRecommendationSchema>;

/** An immutable record of a single lifecycle state change. */
export const lifecycleEventSchema = z.object({
  id: z.string().uuid(),
  modelId: z.string().min(1),
  fromState: lifecycleStateSchema.nullable(),
  toState: lifecycleStateSchema,
  detectedAt: z.string().datetime(),
  verifiedAt: z.string().datetime().nullable().default(null),
  sourceSnapshotRef: z.string().uuid().nullable().default(null),
});
export type LifecycleEvent = z.infer<typeof lifecycleEventSchema>;

/**
 * A candidate record produced by a collector parser, before normalization is verified and
 * published. This is the canonical shape collectors emit into the verification queue.
 */
export const parsedModelRecordSchema = z.object({
  provider: providerSchema,
  modelKey: z.string().min(1),
  displayName: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  lifecycleState: lifecycleStateSchema,
  sourceTerm: z.string().min(1),
  sourceUrl: z.string().url(),
  announcedDate: isoDate.default(null),
  deprecatedDate: isoDate.default(null),
  retirementDate: isoDate.default(null),
  recommendedReplacements: z.array(z.string()).default([]),
});
export type ParsedModelRecord = z.infer<typeof parsedModelRecordSchema>;

/**
 * A model release fact discovered by an *enrichment* (catalog/changelog) collector. Enrichment
 * collectors source data that the lifecycle/deprecation collectors cannot — chiefly the
 * release/announced date — and merge it onto existing models without altering lifecycle state.
 */
export const enrichmentRecordSchema = z.object({
  provider: providerSchema,
  modelKey: z.string().min(1),
  announcedDate: isoDate,
  sourceUrl: z.string().url(),
});
export type EnrichmentRecord = z.infer<typeof enrichmentRecordSchema>;
