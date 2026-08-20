import { z } from 'zod';

/**
 * Blast Radius (`GET /pulls/:id/blast`) — deterministic, no LLM call. Answers
 * "what does this PR touch, transitively?" from `repo-intel`'s persisted
 * index: symbols declared in changed files, their resolved callers
 * (`file:line`, ranked), and the HTTP endpoints / cron jobs reachable within
 * a 2-level reverse import walk.
 *
 * Deliberately NOT a reuse of `BlastRadius` in `./brief.ts` — that contract
 * requires an LLM-authored `summary: string`, has no `status`/`degraded`
 * fields, and is never populated by any module (`PrBrief` has zero writers,
 * see `docs/plans/blast-radius.md` §3.2). New file per the barrel
 * convention — "feature agents EXTEND with new files, they do not edit
 * existing ones" (`../index.ts:14`). `Pr*` name prefix avoids colliding with
 * `brief.ts`'s `BlastRadius`/`BlastCaller`/`ChangedSymbol` once both files
 * are re-exported `export *` from the same barrel (`docs/plans/blast-radius.md`
 * §3.3).
 */

/**
 * Mirrors `repo-intel/types.ts`'s `DegradedReason`, plus `truncated` for a
 * fan-out cap hit on an otherwise full/partial index (no equivalent in
 * `DegradedReason` — that enum only covers index-availability reasons, not
 * a result-shaping one).
 */
export const BlastReason = z.enum([
  'flag_off',
  'index_failed',
  'index_partial',
  'repo_too_large',
  'no_data',
  'truncated',
]);
export type BlastReason = z.infer<typeof BlastReason>;

export const BlastStatus = z.enum(['full', 'partial', 'degraded']);
export type BlastStatus = z.infer<typeof BlastStatus>;

export const PrBlastCaller = z.object({
  file: z.string(),
  symbol: z.string(),
  /** 1-based line of the reference. */
  line: z.number().int(),
  /** `file_rank.rank` of the caller file (0 on the degraded/ripgrep path). */
  rank: z.number(),
});
export type PrBlastCaller = z.infer<typeof PrBlastCaller>;

/** One symbol declared in a changed file, plus everything downstream of it. */
export const PrBlastSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
  callers: z.array(PrBlastCaller),
  /** "METHOD /path" strings, from `file_facts` on caller/downstream files. */
  endpoints: z.array(z.string()),
  crons: z.array(z.string()),
  /** True when `callers` was cut to the per-symbol fan-out cap (20). */
  callers_truncated: z.boolean(),
});
export type PrBlastSymbol = z.infer<typeof PrBlastSymbol>;

export const PrBlastRadius = z.object({
  pr_id: z.string(),
  repo_id: z.string(),
  symbols: z.array(PrBlastSymbol),
  /** Flat union of every symbol's `endpoints`, deduped. */
  impacted_endpoints: z.array(z.string()),
  /** Flat union of every symbol's `crons`, deduped. */
  impacted_crons: z.array(z.string()),
  /**
   * NOT derived from the arrays above on the client — `callers` is capped
   * per symbol and the graph view caps further, so the true totals have to
   * travel alongside the (possibly truncated) arrays.
   */
  counts: z.object({
    symbols: z.number().int(),
    callers: z.number().int(),
    endpoints: z.number().int(),
    crons: z.number().int(),
  }),
  status: BlastStatus,
  reason: BlastReason.nullish(),
});
export type PrBlastRadius = z.infer<typeof PrBlastRadius>;
