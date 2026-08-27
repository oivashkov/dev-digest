/**
 * Demo fixture #2 (lab06 walkthrough) — deliberately weak tests for
 * `rate-limiter.ts`, on purpose: real coverage gaps for a review agent to
 * flag, not a bug in the fixture. See that file's header for why this
 * pair exists. Safe to delete once the walkthrough is recorded.
 */
import { describe, it, expect } from "vitest";
import { tryConsume } from "./rate-limiter";

describe("tryConsume (demo fixture — deliberately weak coverage)", () => {
  it("allows a request when enough tokens are available", () => {
    const state = { tokens: 5, lastRefillMs: 0 };
    expect(tryConsume(state, 1, 0)).toBe(true);
  });

  it("denies a request when the bucket is empty", () => {
    const state = { tokens: 0, lastRefillMs: 0 };
    expect(tryConsume(state, 1, 0)).toBe(false);
  });

  // Over-mocked/weak assertion on purpose: this only checks that `tokens`
  // changed, never that the call actually returned the correct
  // allowed/denied verdict — a test that can stay green even if the
  // function starts returning the wrong boolean.
  it("touches the refill logic", () => {
    const state = { tokens: 5, lastRefillMs: 0 };
    tryConsume(state, 1, 1000);
    expect(state.tokens).not.toBe(5);
  });

  // Note: `cost <= 0` (the boundary this fixture's real bug lives on) has
  // NO test at all — left out on purpose.
});
