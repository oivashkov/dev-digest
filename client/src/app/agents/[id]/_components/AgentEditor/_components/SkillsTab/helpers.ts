/**
 * Pure ordering logic for the Skills tab's attach/reorder list. Linked skills
 * come first (in their configured order), followed by the rest of the
 * workspace's skills — so an unattached skill is still visible to attach.
 */
export function buildInitialOrder(allSkillIds: string[], linkedIdsInOrder: string[]): string[] {
  const linked = new Set(linkedIdsInOrder);
  const rest = allSkillIds.filter((id) => !linked.has(id));
  return [...linkedIdsInOrder, ...rest];
}

/** Swap `id` with its neighbor in `direction` (-1 = up, 1 = down). No-op at the edges. */
export function moveItem(order: string[], id: string, direction: -1 | 1): string[] {
  const idx = order.indexOf(id);
  const swapWith = idx + direction;
  if (idx < 0 || swapWith < 0 || swapWith >= order.length) return order;
  const next = [...order];
  const tmp = next[idx]!;
  next[idx] = next[swapWith]!;
  next[swapWith] = tmp;
  return next;
}

/** Move `id` to sit immediately before `targetId` — the drag-and-drop drop
 *  handler's semantics, independent of drag direction. No-op if either id
 *  is missing or they're the same row. */
export function reorderTo(order: string[], id: string, targetId: string): string[] {
  if (id === targetId) return order;
  const without = order.filter((x) => x !== id);
  const targetIdx = without.indexOf(targetId);
  if (targetIdx < 0) return order;
  const next = [...without];
  next.splice(targetIdx, 0, id);
  return next;
}
