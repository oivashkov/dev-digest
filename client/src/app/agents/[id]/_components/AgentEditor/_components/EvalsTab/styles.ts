import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab. */
export const s = {
  wrap: { maxWidth: 900 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-muted)", marginBottom: 18 } satisfies CSSProperties,
  headerActions: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,

  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 10,
    marginBottom: 24,
  } satisfies CSSProperties,
  metricTile: {
    padding: "14px 16px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  metricLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  metricValue: { fontSize: 22, fontWeight: 700 } satisfies CSSProperties,

  sectionHeader: { display: "flex", alignItems: "center", gap: 10, margin: "8px 0 12px" } satisfies CSSProperties,
  h3: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowName: { fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 } satisfies CSSProperties,
  rowMeta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  rowActions: { display: "flex", alignItems: "center", gap: 4, flexShrink: 0 } satisfies CSSProperties,
  empty: { padding: "24px 0", fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,

  historyRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    cursor: "pointer",
  } satisfies CSSProperties,
  historyRowSelected: { borderColor: "var(--accent)", background: "var(--accent-bg)" } satisfies CSSProperties,
  historyMeta: { fontSize: 12, color: "var(--text-muted)", flex: 1 } satisfies CSSProperties,
} as const;
