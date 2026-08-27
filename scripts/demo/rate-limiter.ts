/**
 * Demo fixture #2 (lab06 walkthrough) — a tiny in-memory token-bucket rate
 * limiter, alongside a deliberately weak test file
 * (`rate-limiter.test.ts`). Together they give a review agent several
 * DIFFERENT classes of test-quality issue to flag (untested error path,
 * missed boundary value, an over-mocked assertion) instead of just the one
 * "no tests at all" issue `eval-pipeline-walkthrough.ts` produces — so the
 * Evals dashboard has more than one case to average across a run.
 *
 * Isolated, unimported — same zero-blast-radius rule as
 * `eval-pipeline-walkthrough.ts`. Safe to delete once the walkthrough is
 * recorded.
 */

export interface RateLimiterState {
  tokens: number;
  lastRefillMs: number;
}

const MAX_TOKENS = 10;
const REFILL_TOKENS_PER_SEC = 1;

/**
 * Returns true if `cost` tokens were available and consumed, false
 * otherwise. `cost <= 0` is invalid input and should be REJECTED (denied),
 * not treated as a free pass.
 */
export function tryConsume(state: RateLimiterState, cost: number, nowMs: number): boolean {
  try {
    if (cost <= 0) throw new Error("cost must be positive");
    const elapsedSec = Math.max(0, nowMs - state.lastRefillMs) / 1000;
    state.tokens = Math.min(MAX_TOKENS, state.tokens + elapsedSec * REFILL_TOKENS_PER_SEC);
    state.lastRefillMs = nowMs;
    if (state.tokens < cost) return false;
    state.tokens -= cost;
    return true;
  } catch {
    // BUG (intentional, for the demo): a malformed `cost` silently ALLOWS
    // the request instead of denying it — the exact kind of untested
    // non-happy path this fixture exists to surface.
    return true;
  }
}
