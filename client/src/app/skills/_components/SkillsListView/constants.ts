import type { SkillType } from "@devdigest/shared";

/** Card grid template (responsive auto-fill) — matches the Agents list. */
export const CARD_GRID_COLS = "repeat(auto-fill, minmax(280px, 1fr))";

/** Skill type → chip colour. */
export const TYPE_COLOR: Record<SkillType, string> = {
  rubric: "#3b82f6",
  convention: "#10b981",
  security: "#ef4444",
  custom: "var(--text-secondary)",
};

export const TYPE_VALUES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** `TYPE_COLOR[type] + alpha-hex` background for a chip/badge — falls back to
 *  a neutral hover tint for `custom`, whose TYPE_COLOR is a CSS var (`var(--x)
 *  1a` isn't valid CSS, unlike the other three types' plain hex). */
export function typeChipBg(color: string): string {
  return color.startsWith("var(") ? "var(--bg-hover)" : color + "1a";
}
