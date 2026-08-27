import { MAX_EVAL_EXPECTATIONS } from '@devdigest/shared';

/**
 * Constants for the `evals` module (SPEC-04). Owned by Step 3
 * (`specs/04-eval-pipeline-plan.md`), consumed by Step 4's `runner.ts` /
 * `routes.ts` — collected here so that later step imports one file instead
 * of re-declaring these values or reaching into `platform/jobs.ts` /
 * `@devdigest/shared` piecemeal.
 */

/** Job kind registered on the JobRunner (`platform/jobs.ts`) for an eval
 *  batch run — mirrors `ONBOARDING_GENERATE_JOB_KIND`'s naming convention
 *  (`onboarding/constants.ts`). */
export const EVAL_BATCH_JOB_KIND = 'eval-batch';

/** Per-kind job timeout for an eval batch (plan §9). `JobRunner`'s
 *  instance-level default is 120s (`platform/jobs.ts`); an 8+ case batch of
 *  sequential LLM calls will exceed that, so the eval kind needs its own,
 *  much larger budget once Step 4 adds per-kind timeout support to
 *  `JobRunner.register`/`enqueue`. Not itself wired here — Step 3 owns only
 *  the value. */
export const EVAL_BATCH_JOB_TIMEOUT_MS = 10 * 60_000; // 10 minutes

/** Per-route rate limit for the two LLM-triggering eval endpoints (`POST
 *  /agents/:id/eval-runs`, `POST /eval-cases/:id/run`) — same shape as the
 *  existing review endpoints (`reviews/routes.ts:41,196,221`). */
export const EVAL_RUN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

/** Re-exported so `evals/` code imports the `expected_output` array cap from
 *  this module's own constants surface rather than reaching into
 *  `@devdigest/shared` directly for it — the authoritative value (and its
 *  `.max()` enforcement, `EvalExpectationArray`) still lives in
 *  `contracts/eval-ci.ts`; this is a convenience alias, not a second
 *  definition. */
export const EVAL_EXPECTATION_ARRAY_CAP = MAX_EVAL_EXPECTATIONS;

/** Max characters of the title-derived slug portion of a deterministically
 *  derived eval case name (AC 13, `deriveEvalCaseName` in `helpers.ts`) —
 *  leaves room for the `__file:start_line` suffix within
 *  `MAX_EVAL_CASE_NAME_LENGTH` (`@devdigest/shared`'s `contracts/eval-ci.ts`,
 *  currently 200) so a long finding title can't silently overflow the
 *  case-name column's cap. */
export const EVAL_CASE_NAME_SLUG_MAX_LENGTH = 80;
