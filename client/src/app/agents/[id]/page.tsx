/* Route: /agents/:id (Agent Editor). Thin route entry (Server Component) —
   the view, sidebar, styles, constants and tab-editor are colocated under
   _components/AgentEditorPageView, itself 'use client' since it's fully
   hook/query-driven. */
import { AgentEditorPageView } from "./_components/AgentEditorPageView";

export default function AgentEditorPage() {
  return <AgentEditorPageView />;
}
