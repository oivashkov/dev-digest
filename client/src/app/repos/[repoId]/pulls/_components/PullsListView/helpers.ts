import type { PrMeta } from "../../constants";

/** Open PRs carry a derived review status; everything else is merged/closed. */
export const OPEN_STATUSES = new Set(["needs_review", "reviewed", "stale"]);

export type SortOrder = "newest" | "oldest";

/** Filter by status + free-text query, then sort by updated_at. Pure — no
 *  fetch/state — so the list page's derived-data logic is unit-testable. */
export function filterAndSortPulls(
  pulls: PrMeta[],
  status: string,
  query: string,
  sort: string,
): PrMeta[] {
  const q = query.trim().toLowerCase();
  return pulls
    .filter((p) => status === "all" || p.status === status)
    .filter((p) => !q || p.title.toLowerCase().includes(q) || String(p.number).includes(q))
    .slice()
    .sort((a, b) => {
      const ta = Date.parse(a.updated_at ?? "") || 0;
      const tb = Date.parse(b.updated_at ?? "") || 0;
      return sort === "oldest" ? ta - tb : tb - ta;
    });
}

export function countOpen(pulls: PrMeta[]): number {
  return pulls.filter((p) => OPEN_STATUSES.has(p.status)).length;
}

export function countNeedsReview(pulls: PrMeta[]): number {
  return pulls.filter((p) => p.status === "needs_review").length;
}
