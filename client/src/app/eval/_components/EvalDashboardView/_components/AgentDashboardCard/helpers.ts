import type { EvalRunRecord } from "@devdigest/shared";

/** Most recent `EvalRunRecord` in `recentRuns` by `ran_at`, or `null` when
   there are none — backs the row subtitle's "Last run … {ran_at}" text.
   Picks the max `ran_at` explicitly, same as `EvalsTab/helpers.ts`'s
   `findLatestRun` — `recent_runs` order is not contractually guaranteed. */
export function latestRunRecord(recentRuns: EvalRunRecord[] | undefined): EvalRunRecord | null {
  const rows = recentRuns ?? [];
  if (rows.length === 0) return null;
  return rows.reduce((best, r) => (r.ran_at > best.ran_at ? r : best));
}
