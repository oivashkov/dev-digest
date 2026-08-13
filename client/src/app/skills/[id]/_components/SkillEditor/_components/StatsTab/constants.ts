import type { FindingCategory } from "@devdigest/shared";

/** Category → CSS var (see globals.css) — fixed order, one color per category,
 *  never reassigned by rank/filter. */
export const CATEGORY_COLOR: Record<FindingCategory, string> = {
  bug: "var(--cat-bug)",
  security: "var(--cat-security)",
  perf: "var(--cat-perf)",
  style: "var(--cat-style)",
  test: "var(--cat-test)",
};
