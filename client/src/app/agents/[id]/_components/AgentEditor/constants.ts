import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
];

/** Derived from TABS so a new tab is valid the moment it's added here — see
 *  SkillEditor/constants.ts's identical pattern. AgentEditorPageView used to
 *  hardcode this list separately and missed "context" when the Context tab
 *  was added, silently bouncing the tab back to "config" on click. */
export const VALID_TABS: readonly string[] = TABS.map((tb) => tb.key);
