/* Route: /repos/:repoId/conventions. Thin route entry (Server Component) —
   the view, its cards, the create-skill modal, styles and i18n are colocated
   under _components/ConventionsListView, itself 'use client' since it's
   fully hook/query-driven. */
import { ConventionsListView } from "./_components/ConventionsListView";

export default function ConventionsPage() {
  return <ConventionsListView />;
}
