/**
 * Pure helpers for the Skill editor's Context section. Unlike the Agent
 * editor's ContextTab, this list is NOT reorderable (Q13) — the server
 * already sorts a skill's attached documents by normalized path, so there is
 * no drag-order concept to seed or persist here.
 */

/** Attached paths first (sorted), then the rest of the repo's discovered
 *  documents — so an unattached document is still visible to attach. */
export function buildVisibleList(allDiscoveredPaths: string[], attachedPaths: string[]): string[] {
  const attached = new Set(attachedPaths);
  const rest = allDiscoveredPaths.filter((p) => !attached.has(p));
  return [...[...attached].sort(), ...rest];
}

/** Case-insensitive path-substring filter (same rule as the Agent editor's
 *  Context tab). */
export function filterPaths(paths: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return paths;
  return paths.filter((p) => p.toLowerCase().includes(q));
}
