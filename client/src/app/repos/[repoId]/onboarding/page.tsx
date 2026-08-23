/* Route: /repos/:repoId/onboarding. Thin route entry (Server Component) —
   the view, its section cards, styles and i18n are colocated under
   _components/OnboardingTourView, itself 'use client' since it's fully
   hook/query-driven. Not to be confused with /onboarding, the unrelated
   add-repo wizard (see app-shell/helpers.ts's activeKeyFor guard). */
import { OnboardingTourView } from "./_components/OnboardingTourView";

export default function OnboardingTourPage() {
  return <OnboardingTourView />;
}
