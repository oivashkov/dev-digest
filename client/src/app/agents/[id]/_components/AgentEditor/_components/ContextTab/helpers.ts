/**
 * Pure ordering logic for the Context tab's attach/reorder list — same shape
 * as `SkillsTab/helpers.ts` (kept a separate, small copy rather than a
 * shared `src/lib/` promotion; the two call sites' surrounding row-shape
 * differs enough that a shared abstraction would need its own config
 * parameter to stay generic, which isn't worth it for ~25 lines yet).
 * Attached paths come first (drag order), followed by the rest of the
 * repo's discovered documents — so an unattached document is still visible
 * to attach. A path that's attached but no longer discovered (missing, Q7)
 * stays in the list too, since it only ever comes from `attachedInOrder`.
 */
export function buildInitialOrder(allDiscoveredPaths: string[], attachedInOrder: string[]): string[] {
  const attached = new Set(attachedInOrder);
  const rest = allDiscoveredPaths.filter((p) => !attached.has(p));
  return [...attachedInOrder, ...rest];
}

/** Swap `path` with its neighbor in `direction` (-1 = up, 1 = down). No-op at the edges. */
export function moveItem(order: string[], path: string, direction: -1 | 1): string[] {
  const idx = order.indexOf(path);
  const swapWith = idx + direction;
  if (idx < 0 || swapWith < 0 || swapWith >= order.length) return order;
  const next = [...order];
  const tmp = next[idx]!;
  next[idx] = next[swapWith]!;
  next[swapWith] = tmp;
  return next;
}

/** Move `path` to sit immediately before `targetPath` — the drop handler's
 *  semantics, independent of drag direction. No-op if either is missing or
 *  they're the same row. */
export function reorderTo(order: string[], path: string, targetPath: string): string[] {
  if (path === targetPath) return order;
  const without = order.filter((x) => x !== path);
  const targetIdx = without.indexOf(targetPath);
  if (targetIdx < 0) return order;
  const next = [...without];
  next.splice(targetIdx, 0, path);
  return next;
}

/** Case-insensitive path-substring filter (SPEC-01: "documents whose path
 *  contains the typed text"). */
export function filterPaths(paths: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return paths;
  return paths.filter((p) => p.toLowerCase().includes(q));
}

/** Union of every path attached (directly or via an enabled linked skill,
 *  Q3), deduplicated — used only for the "N of M attached" / token-total
 *  displays, which count the assembled set the same way run-time assembly
 *  does. */
export function unionPaths(...groups: string[][]): Set<string> {
  const out = new Set<string>();
  for (const g of groups) for (const p of g) out.add(p);
  return out;
}
