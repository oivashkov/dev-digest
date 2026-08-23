/* Route: /repos/:repoId/context. Thin route entry (Server Component) — the
   view, its list/preview panes, styles and i18n are colocated under
   _components/ProjectContextView, itself 'use client' since it's fully
   hook/query-driven. */
import { ProjectContextView } from "./_components/ProjectContextView";

export default function ProjectContextPage() {
  return <ProjectContextView />;
}
