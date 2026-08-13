import type { SkillType } from "@devdigest/shared";

/** Constants for CreateSkillFromConventionsModal. */
export const MODAL_WIDTH = 640;

/** Conventions extracted this way are, definitionally, `type: 'convention'`. */
export const DEFAULT_TYPE: SkillType = "convention";

/** Local copy of the skill type enum (avoids reaching into the Skills
 *  route's private `_components/SkillsListView/constants.ts`). */
export const TYPE_VALUES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];
