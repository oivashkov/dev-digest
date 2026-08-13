import type { Skill } from "@devdigest/shared";

/** Case-insensitive filter over a skill's name + description. Generic over
 *  `T extends Skill` so it preserves `SkillSummary`'s extra fields for
 *  callers that have them (both the grid list and the editor sidebar do). */
export function filterSkills<T extends Skill>(skills: T[], search: string): T[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q));
}
