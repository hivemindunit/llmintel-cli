/**
 * The canonical LLMIntel lifecycle state machine.
 *
 * Every provider uses different lifecycle vocabulary. LLMIntel maps all of them onto this
 * single, ordered state machine so that downstream consumers (API, alerts, CI gating) reason
 * about one vocabulary with precise, documented semantics.
 */

export const LIFECYCLE_STATES = [
  "announced",
  "active",
  "legacy",
  "deprecated",
  "retiring",
  "retired",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/**
 * Precise, documented meaning of each canonical state. These semantics are part of the public
 * contract: the normalization layer maps provider terms onto whichever state matches the
 * behavior described here, not the provider's wording.
 */
export const LIFECYCLE_SEMANTICS: Record<LifecycleState, string> = {
  announced: "Model has been announced by the provider but is not yet generally available.",
  active: "Generally available. API calls succeed; recommended for new workloads.",
  legacy: "Still callable, but superseded and no longer recommended for new workloads.",
  deprecated: "No new customers/usage onboarding; existing API calls still succeed.",
  retiring: "A hard retirement date is scheduled and imminent; calls still succeed until then.",
  retired: "Shut down. API calls fail.",
};

const ORDER: Record<LifecycleState, number> = Object.fromEntries(
  LIFECYCLE_STATES.map((state, index) => [state, index]),
) as Record<LifecycleState, number>;

/** Monotonic position of a state in the lifecycle (0 = earliest, higher = closer to retired). */
export function lifecycleOrder(state: LifecycleState): number {
  return ORDER[state];
}

/** Type guard for arbitrary strings. */
export function isLifecycleState(value: string): value is LifecycleState {
  return value in ORDER;
}

/**
 * A transition is valid only if it moves strictly forward through the lifecycle. Providers may
 * skip intermediate states (e.g. `active` -> `deprecated`), but a model never moves backward and
 * `retired` is terminal.
 */
export function isValidTransition(from: LifecycleState, to: LifecycleState): boolean {
  return ORDER[to] > ORDER[from];
}

export class InvalidLifecycleTransitionError extends Error {
  constructor(
    public readonly from: LifecycleState,
    public readonly to: LifecycleState,
  ) {
    super(`Invalid lifecycle transition: ${from} -> ${to}`);
    this.name = "InvalidLifecycleTransitionError";
  }
}

export function assertValidTransition(from: LifecycleState, to: LifecycleState): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidLifecycleTransitionError(from, to);
  }
}
