import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/**
 * One deterministic, advisory hit: a changed file whose path lexically
 * overlaps a phrase from the PR's own stated `out_of_scope` list — i.e. the
 * PR claims not to touch this area, but a changed file's path suggests it
 * might. String-matching only, no LLM call, no semantic understanding —
 * intentionally crude (see docs/plans/intent-scope-drift.md §2 for why: the
 * academic prior art this followed found accuracy weakest in exactly the
 * "subtle, ambiguous" middle ground a cleverer heuristic would chase). Never
 * escalates a finding's severity — advisory only, surfaced to the reviewer.
 */
export const ScopeDriftHit = z.object({
  file: z.string(),
  matched_phrase: z.string(),
});
export type ScopeDriftHit = z.infer<typeof ScopeDriftHit>;

/**
 * Intent persisted for a PR (the Intent plus the pr_id it scopes), plus
 * `scope_drift` — computed fresh from the PR's CURRENT changed-file list on
 * every read, never persisted on `pr_intent`. Unlike the rest of `Intent`
 * (cached until a manual Refresh), this stays live even against a stale
 * cached intent, since it only depends on `out_of_scope` (already cached)
 * and the file list (which can change without anyone re-running the
 * classifier).
 */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  scope_drift: z.array(ScopeDriftHit).default([]),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;
