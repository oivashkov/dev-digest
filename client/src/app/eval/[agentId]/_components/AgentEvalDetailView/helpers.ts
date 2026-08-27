import type { Agent } from "@devdigest/shared";

/** Same cap-at-2 selection logic as `EvalsTab/EvalsTab.tsx`'s
   `toggleCompareSelection` (read there, not duplicated by import — that
   function is a component-local closure, not exported) — toggle a
   `PersistedRunEntry.key` in/out of the selection, silently ignoring a third
   click once two are already selected. */
export function toggleCompareSelection(selected: string[], key: string): string[] {
  return selected.includes(key)
    ? selected.filter((id) => id !== key)
    : selected.length < 2
      ? [...selected, key]
      : selected;
}

/** Agent picker options: every enabled agent, plus the current agent even
   when disabled — so navigating here directly for a disabled agent still
   renders a `<select>` whose value matches one of its own options, instead
   of an empty/mismatched selection. */
export function pickerOptions(
  agents: Agent[] | undefined,
  currentAgentId: string,
): { value: string; label: string }[] {
  const list = (agents ?? []).filter((a) => a.enabled || a.id === currentAgentId);
  return list.map((a) => ({ value: a.id, label: a.name }));
}
