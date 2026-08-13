import type { CSSProperties } from "react";

/** Co-located styles for the skill editor page view — mirrors
 *  AgentEditorPageView's split-pane layout (sidebar list + tabbed editor). */
export const s = {
  layout: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  sidebar: {
    width: 300,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  sidebarHeader: { padding: "16px 16px 12px" } satisfies CSSProperties,
  sidebarHeaderRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  } satisfies CSSProperties,
  sidebarTitle: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  sidebarSearch: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  } satisfies CSSProperties,
  sidebarSearchIcon: { position: "absolute", left: 10, color: "var(--text-muted)" } satisfies CSSProperties,
  sidebarSearchInput: {
    width: "100%",
    padding: "8px 10px 8px 30px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,
  sidebarList: { flex: 1, overflow: "auto", padding: "12px 12px 12px" } satisfies CSSProperties,
  editorLoading: {
    flex: 1,
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
  editorWrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,
  editorHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 28px 0",
    flexShrink: 0,
  } satisfies CSSProperties,
  editorHeaderIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  editorHeaderTitle: { fontSize: 18, fontWeight: 700, fontFamily: "var(--font-mono, monospace)" } satisfies CSSProperties,
  editorHeaderSpacer: { marginLeft: "auto" } satisfies CSSProperties,
  editorBody: { flex: 1, minHeight: 0, overflow: "auto" } satisfies CSSProperties,
} as const;
