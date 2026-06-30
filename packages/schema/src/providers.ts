import type { LifecycleState } from "./lifecycle";

/** Providers LLMIntel tracks. The first five are the primary launch set. */
export const PROVIDERS = [
  "openai",
  "anthropic",
  "azure",
  "bedrock",
  "google",
  "mistral",
  "cohere",
] as const;

export type Provider = (typeof PROVIDERS)[number];

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

/**
 * Provider-specific lifecycle vocabulary mapped onto the canonical state machine. Keys are the
 * verbatim provider term, lowercased. The mapping is intentionally explicit (rather than fuzzy)
 * so that an unrecognized term fails loud instead of being silently misclassified.
 */
export const PROVIDER_TERM_MAP: Record<Provider, Record<string, LifecycleState>> = {
  openai: {
    deprecated: "deprecated",
    deprecation: "deprecated",
    shutdown: "retired",
    "shut down": "retired",
    "shut-down": "retired",
    retired: "retired",
  },
  anthropic: {
    active: "active",
    legacy: "legacy",
    deprecated: "deprecated",
    retiring: "retiring",
    retired: "retired",
  },
  azure: {
    active: "active",
    deprecated: "deprecated",
    "to be retired": "retiring",
    retirement: "retiring",
    retired: "retired",
  },
  bedrock: {
    active: "active",
    legacy: "legacy",
    "end of life": "retiring",
    eol: "retiring",
    deprecated: "deprecated",
    retired: "retired",
  },
  google: {
    available: "active",
    active: "active",
    legacy: "legacy",
    deprecated: "deprecated",
    deprecation: "deprecated",
    "discontinuation date": "retiring",
    "shutdown date": "retiring",
    shutdown: "retired",
    "shut down": "retired",
    retired: "retired",
    discontinued: "retired",
  },
  mistral: {},
  cohere: {
    active: "active",
    legacy: "legacy",
    deprecated: "deprecated",
    deprecation: "deprecated",
    retiring: "retiring",
    shutdown: "retired",
    "shut down": "retired",
    retired: "retired",
  },
};
