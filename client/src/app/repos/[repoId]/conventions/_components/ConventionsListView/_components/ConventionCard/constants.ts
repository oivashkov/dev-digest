import type { ConventionCategory } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** Category → icon. `CategoryTag` (vendor/ui) is hard-bound to finding
 *  categories, not convention categories, so this small local map stands in
 *  for it here — same `Badge` primitive underneath. */
export const CATEGORY_ICON: Record<ConventionCategory, IconName> = {
  naming: "Tag",
  structure: "Layers",
  error_handling: "AlertTriangle",
  imports: "Boxes",
  formatting: "Code",
  testing: "FlaskConical",
  other: "Hash",
};
