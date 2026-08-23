import type { IconName } from "@devdigest/ui";
import type { OnboardingSectionKind } from "@devdigest/shared";

/** Skeleton rows shown while the tour loads. */
export const SKELETON_ROWS = 3;

/** Rail/card icon per canonical section kind — fixed order matches the
 *  persisted order (SPEC-02 Q1/Q3). */
export const SECTION_ICON: Record<OnboardingSectionKind, IconName> = {
  architecture: "Layers",
  critical_paths: "Target",
  local_setup: "Wrench",
  reading_path: "ArrowRight",
  first_tasks: "ListChecks",
};

export const SECTION_ORDER: OnboardingSectionKind[] = [
  "architecture",
  "critical_paths",
  "local_setup",
  "reading_path",
  "first_tasks",
];

/** How long the "Copied" confirmation stays visible after a clipboard write. */
export const COPY_FEEDBACK_MS = 1500;
