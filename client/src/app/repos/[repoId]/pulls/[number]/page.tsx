/* Route: /repos/:repoId/pulls/:number (PR detail). Thin route entry (Server
   Component) — the view, tabs, styles, and i18n are colocated under
   _components/PrDetailView, itself 'use client' since it's fully
   hook/query-driven. */
import { PrDetailView } from "./_components/PrDetailView";

export default function PRDetailPage() {
  return <PrDetailView />;
}
