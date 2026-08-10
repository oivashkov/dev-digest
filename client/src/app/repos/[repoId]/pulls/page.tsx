/* Route: /repos/:repoId/pulls (PR list). Thin route entry (Server Component)
   — the view, its filter bar, styles, constants, helpers and i18n are
   colocated under _components/PullsListView, itself 'use client' since it's
   fully hook/query-driven. (constants/styles/helpers shared with the whole
   pulls/ subtree stay at this route root — see FilterBar, PRRow, and the
   [number] detail route.) */
import { PullsListView } from "./_components/PullsListView";

export default function PullsPage() {
  return <PullsListView />;
}
