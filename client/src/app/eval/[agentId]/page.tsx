import { AgentEvalDetailView } from "./_components/AgentEvalDetailView";

/* Route: /eval/:agentId — per-agent Eval drill-down. Thin route entry (Server
   Component) — the view is a Client Component (it imports @devdigest/ui, per
   client/INSIGHTS.md 2026-08-10: any file importing @devdigest/ui must be
   "use client" or the whole app 500s) colocated under
   _components/AgentEvalDetailView, same shape as the sibling /eval list page
   (`../page.tsx`). */
export default function AgentEvalDetailPage() {
  return <AgentEvalDetailView />;
}
