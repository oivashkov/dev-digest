/* EvalsTab/helpers.ts — pure helpers for the per-agent Evals tab.

   `deriveCaseStatus` reads a case's pass/fail off the agent dashboard's
   `recent_runs` (AC 69: never-run must NOT render as failing).

   `groupRecentRunsIntoBatches` + `PersistedRunEntry` back the Compare-runs
   modal (ACs 49-59), reading `dashboard.recent_runs` — real, server-
   persisted history — instead of the session-scoped `RunHistoryEntry`
   in-memory list this file used to keep (see `client/INSIGHTS.md`,
   2026-08-27 Decision, "Sharper case found" addendum: that in-memory list
   reset on every navigation away from the Evals tab, which made a same-
   session "run, edit prompt, run again, compare" walkthrough impossible).
   `EvalRunRecord` gained `agent_version`/`batch_id` on the wire for exactly
   this — both columns already existed on `eval_runs`, they just weren't
   serialized. `groupRuns`/`buildAggregate` below are a client-side mirror of
   `server/src/modules/evals/service.ts`'s functions of the same names —
   same grouping key (`batch_id`, or `single:<row id>` for a lone
   `batch_id IS NULL` row), same mean/sum aggregation — so a batch's Compare
   entry matches what the dashboard's own trend/current tiles show for it. */
import type { EvalRun, EvalRunRecord } from "@devdigest/shared";

export type CaseRunState = "never-run" | "passed" | "failed";

export interface CaseStatus {
  state: CaseRunState;
  recall: number | null;
}

/** Most recent `eval_runs` row for `caseId` among the dashboard's
 *  `recent_runs` (already agent-scoped). Picks the max `ran_at` explicitly —
 *  `recent_runs` order is not contractually guaranteed. */
export function findLatestRun(caseId: string, recentRuns: EvalRunRecord[] | undefined): EvalRunRecord | null {
  const rows = (recentRuns ?? []).filter((r) => r.case_id === caseId);
  if (rows.length === 0) return null;
  return rows.reduce((best, r) => (r.ran_at > best.ran_at ? r : best));
}

export function deriveCaseStatus(caseId: string, recentRuns: EvalRunRecord[] | undefined): CaseStatus {
  const latest = findLatestRun(caseId, recentRuns);
  if (!latest) return { state: "never-run", recall: null };
  return { state: latest.pass ? "passed" : "failed", recall: latest.recall };
}

/** One dispatched batch (or a lone single-case run), reconstructed from
 *  persisted `EvalRunRecord` rows — the Compare-runs table's row shape.
 *  `agentVersion` is `null` for a row that predates the column; the Compare
 *  modal treats that as "no prompt to diff", not as version 0. */
export interface PersistedRunEntry {
  /** Stable React key + selection id — `batchId`, or `single:<row id>` for a
   *  lone unbatched row, so two different null-`batchId` rows never collide. */
  key: string;
  batchId: string | null;
  agentVersion: number | null;
  /** Latest `ran_at` among the group's rows (ISO string). */
  ranAt: string;
  result: EvalRun;
}

const MAX_PERSISTED_RUNS = 10;

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

/** Mirrors `server/src/modules/evals/service.ts#buildAggregate` — same
 *  mean/sum rules, so a batch's Compare metrics match the dashboard's own
 *  aggregate for it. `per_trace` stays empty: CompareRunsModal never renders
 *  per-trace detail, and `EvalRunRecord` doesn't carry `expected_output`
 *  (only `EvalCase` does) to populate it faithfully anyway. */
function buildAggregate(rows: EvalRunRecord[]): EvalRun {
  const tracesTotal = rows.length;
  const tracesPassed = rows.filter((r) => r.pass === true).length;
  const costs = rows.map((r) => r.cost_usd);
  const costUsd = costs.every((c) => c == null) ? null : costs.reduce<number>((sum, c) => sum + (c ?? 0), 0);
  return {
    recall: mean(rows.map((r) => r.recall ?? 0)),
    precision: mean(rows.map((r) => r.precision ?? 0)),
    citation_accuracy: mean(rows.map((r) => r.citation_accuracy ?? 0)),
    traces_passed: tracesPassed,
    traces_total: tracesTotal,
    duration_ms: rows.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0),
    cost_usd: costUsd,
    per_trace: [],
  };
}

/** Groups `dashboard.recent_runs` (case-granularity) into batch-granularity
 *  `PersistedRunEntry` rows, newest-first, capped so a long-lived agent's
 *  full history doesn't grow the Compare list unbounded. `agentVersion` is
 *  the group's own value if every row agrees (the normal case — one dispatch
 *  stamps every row it produces with the same version); falls back to the
 *  first non-null value if rows disagree (shouldn't happen in practice, but
 *  a run that mixes versions is more informative shown as one than dropped). */
export function groupRecentRunsIntoBatches(rows: EvalRunRecord[]): PersistedRunEntry[] {
  const groups = new Map<string, EvalRunRecord[]>();
  for (const row of rows) {
    const key = row.batch_id ?? `single:${row.id}`;
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  const entries: PersistedRunEntry[] = [];
  for (const [key, group] of groups) {
    const ranAt = group.reduce((latest, r) => (r.ran_at > latest ? r.ran_at : latest), group[0]!.ran_at);
    const agentVersion = group.find((r) => r.agent_version != null)?.agent_version ?? null;
    entries.push({ key, batchId: group[0]!.batch_id, agentVersion, ranAt, result: buildAggregate(group) });
  }
  entries.sort((a, b) => (a.ranAt < b.ranAt ? 1 : a.ranAt > b.ranAt ? -1 : 0));
  return entries.slice(0, MAX_PERSISTED_RUNS);
}

/** 0..1 → "42%", rounded — shared by the metric tiles, case rows, and the
 *  compare table. */
export function formatPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
