import { describe, expect, it } from "vitest";
import {
  InvalidLifecycleTransitionError,
  LIFECYCLE_SEMANTICS,
  LIFECYCLE_STATES,
  assertValidTransition,
  isLifecycleState,
  isValidTransition,
  lifecycleOrder,
} from "./lifecycle";

describe("lifecycle state machine", () => {
  it("has a documented semantic for every state", () => {
    for (const state of LIFECYCLE_STATES) {
      expect(LIFECYCLE_SEMANTICS[state]).toBeTruthy();
    }
  });

  it("orders states monotonically", () => {
    expect(lifecycleOrder("announced")).toBeLessThan(lifecycleOrder("active"));
    expect(lifecycleOrder("deprecated")).toBeLessThan(lifecycleOrder("retired"));
  });

  it("allows forward transitions, including skips", () => {
    expect(isValidTransition("announced", "active")).toBe(true);
    expect(isValidTransition("active", "deprecated")).toBe(true);
    expect(isValidTransition("deprecated", "retired")).toBe(true);
  });

  it("rejects backward and self transitions", () => {
    expect(isValidTransition("retired", "active")).toBe(false);
    expect(isValidTransition("deprecated", "deprecated")).toBe(false);
    expect(isValidTransition("retiring", "legacy")).toBe(false);
  });

  it("treats retired as terminal", () => {
    for (const state of LIFECYCLE_STATES) {
      expect(isValidTransition("retired", state)).toBe(false);
    }
  });

  it("throws on invalid transitions via assert", () => {
    expect(() => assertValidTransition("retired", "active")).toThrow(
      InvalidLifecycleTransitionError,
    );
    expect(() => assertValidTransition("announced", "retired")).not.toThrow();
  });

  it("guards arbitrary strings", () => {
    expect(isLifecycleState("active")).toBe(true);
    expect(isLifecycleState("nonsense")).toBe(false);
  });
});
