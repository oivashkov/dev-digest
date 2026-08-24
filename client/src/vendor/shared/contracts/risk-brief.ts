import { z } from 'zod';
import { Risk, RiskSeverity } from './brief.js';

/**
 * PR Why + Risk Brief (`GET /pulls/:id/brief`) — one structured LLM call over
 * already-computed signals (intent, blast radius, diff stats, linked ticket,
 * plan/spec excerpts — never diff hunk bodies) that answers "what changed,
 * why, how risky, what to read first".
 *
 * Deliberately NOT a reshape of `PrBrief` in `./brief.ts` — that contract
 * composes `Intent`/`BlastRadius`/`Risks`/`PrHistory` under different field
 * names (no `what`/`why`/`review_focus`) and has zero writers (root
 * `INSIGHTS.md` 2026-08-24, mirroring `blast.ts:1-19`'s own precedent for
 * `PrBlastRadius` vs. `brief.ts`'s unused `BlastRadius`). New file per the
 * barrel convention — "feature agents EXTEND with new files, they do not
 * edit existing ones" (`../index.ts:14`). `Pr`/`RiskBrief` naming avoids
 * colliding with `brief.ts`'s `PrBrief` once both are re-exported `export *`
 * from the same barrel; `Risk`/`RiskSeverity` are imported from `./brief.js`
 * rather than redeclared (§5 of the plan: `brief.ts` stays untouched).
 */

/** One cited location the reviewer should look at first, and why. */
export const ReviewFocusItem = z.object({
  file: z.string(),
  /**
   * 1-based line, when the model cited one. `.nullish()`, not `.optional()`
   * — OpenAI's structured-outputs strict mode requires every property to be
   * present and rejects a bare `.optional()` field (`zodResponseFormat`
   * warns "uses `.optional()` without `.nullable()`... this will become an
   * error in a future version of the SDK"); the model emits `null` instead
   * of omitting the key.
   */
  line: z.number().int().nullish(),
  /** `METHOD /path` or cron name — grounded against blast's impacted sets. Same `.nullish()` reasoning as `line`. */
  endpoint: z.string().nullish(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

/**
 * The raw shape returned by the risk-brief LLM call. No `risk_level` (AC15)
 * and no `confidence` field — mirrors how `IntentExtraction` deliberately
 * omits `confidence`; both are server-computed, never a model self-report.
 */
export const RiskBriefExtraction = z.object({
  what: z.string(),
  why: z.string(),
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
});
export type RiskBriefExtraction = z.infer<typeof RiskBriefExtraction>;

/**
 * The persisted/transport shape (`pr_brief.json`): `RiskBriefExtraction`
 * plus `pr_id`, the server-computed `risk_level` (max severity over the
 * post-grounding `risks[]`, never a model self-report — same principle as
 * `tierFor()` in `server/src/modules/reviews/intent.ts`), and `head_sha` —
 * the commit the brief was computed against (OQ4). `head_sha` lives inside
 * this blob rather than a new column — no migration.
 */
export const PrRiskBrief = RiskBriefExtraction.extend({
  pr_id: z.string(),
  risk_level: RiskSeverity,
  head_sha: z.string(),
});
export type PrRiskBrief = z.infer<typeof PrRiskBrief>;
