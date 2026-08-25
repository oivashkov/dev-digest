import type { CSSProperties } from "react";

/** Co-located styles for ProjectContextView — mirrors ConventionsListView's
 *  page/header shape, with a two-pane list+preview body. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1200, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 8 } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repoName: { color: "var(--accent-text)" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,

  filterInput: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontSize: 13,
    marginTop: 18,
    marginBottom: 12,
  } satisfies CSSProperties,

  body: {
    display: "grid",
    gridTemplateColumns: "340px 1fr",
    gap: 16,
    alignItems: "start",
  } satisfies CSSProperties,

  listCard: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  listRow: (active: boolean) =>
    ({
      display: "flex",
      flexDirection: "column",
      gap: 4,
      padding: "10px 14px",
      cursor: "pointer",
      borderBottom: "1px solid var(--border)",
      background: active ? "var(--bg-hover)" : "transparent",
    }) satisfies CSSProperties,
  rowTop: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  rowPath: { fontSize: 13, fontWeight: 600, wordBreak: "break-all" } satisfies CSSProperties,
  rowMeta: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  typeBadge: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    padding: "1px 6px",
    flexShrink: 0,
  } satisfies CSSProperties,
  listEmpty: { padding: "18px 14px", fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,

  previewCard: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: "18px 22px",
    minHeight: 300,
    fontSize: 14,
  } satisfies CSSProperties,
  previewHint: { color: "var(--text-muted)", fontSize: 13 } satisfies CSSProperties,
  previewPath: { fontSize: 13, color: "var(--text-muted)", marginBottom: 12 } satisfies CSSProperties,

  footer: {
    marginTop: 16,
    fontSize: 12,
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } satisfies CSSProperties,

  loadingStack: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
