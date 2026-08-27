import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /eval — workspace-wide Eval Dashboard (SPEC-04 plan, Step 10). Thin
   route entry — the view is a Client Component (it imports @devdigest/ui,
   per client/INSIGHTS.md 2026-08-10: any file importing @devdigest/ui must
   be "use client" or the whole app 500s) colocated under
   _components/EvalDashboardView. */
export default function EvalDashboardPage() {
  return <EvalDashboardView />;
}
