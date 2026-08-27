import type { EvalDashboard } from "@devdigest/shared";

/** Converts a plain `<input type="date">` value ("YYYY-MM-DD") into an ISO
   instant at UTC midnight for the `since` query param (AC 62), or
   `undefined` when the field is empty/unparseable so the hook omits the
   param entirely rather than sending a bad value the server would 422 on
   (AC 63) — the date `<input>` itself already constrains the format, so
   this is a defensive parse, not user-facing validation. Shared by the
   dashboard list page and the per-agent drill-down page — both have their
   own `since` date input. */
export function sinceInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** `@devdigest/ui`'s `Sparkline` (`vendor/ui/charts/Sparkline.tsx`) divides by
   `data.length - 1` to place points along its x-axis, so a single-point
   trend (AC 65: "exactly one recorded run") produces `0/0` → `NaN` `cx`/`d`
   SVG attributes — a real, reachable case here, not a hypothetical one.
   `vendor/ui` is off-limits to edit (`client/AGENTS.md`), so the fix lives on
   the consumer side: never pass a single-point trend into `MetricCard`'s
   `trend` prop, which already renders no sparkline at all when `trend` is
   `undefined`. Promoted here from `AgentDashboardCard/helpers.ts` once the
   per-agent drill-down page needed the same guard for its own MetricCard
   tiles (client/INSIGHTS.md, 2026-08-27). */
export function trendOrUndefined(values: number[]): number[] | undefined {
  return values.length > 1 ? values : undefined;
}

/** Sum of `cases_total` across every agent's dashboard entry — the number
   named in the Run-all-agents confirmation (AC 72). List-page only. */
export function totalCaseCount(dashboards: EvalDashboard[]): number {
  return dashboards.reduce((sum, d) => sum + d.cases_total, 0);
}

/** AC 67: an agent with zero recorded runs gets the `noRuns` empty state
   instead of zeroed metric tiles — judged off `recent_runs`, which is
   restricted by `since` the same way `trend` is, not off `cases_total`
   (a case set can be non-empty with nothing run against it yet). */
export function hasRecordedRuns(dashboard: EvalDashboard | undefined): boolean {
  return (dashboard?.recent_runs.length ?? 0) > 0;
}
