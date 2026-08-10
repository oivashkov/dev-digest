/**
 * Diff stats aren't on GitHub's PR-list payload, so freshly-imported PRs land
 * with zeroed size/diff. Backfill them once from the detail endpoint so the
 * list shows real S/M/L + ± counts. Capped per request (each backfill is a
 * detail fetch) — the periodic refetch chips away at any remainder.
 */
export const BACKFILL_LIMIT = 10;
