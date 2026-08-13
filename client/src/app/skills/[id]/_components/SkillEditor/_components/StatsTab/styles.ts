import type { CSSProperties } from "react";

/** Co-located styles for StatsTab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  tilesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
  } satisfies CSSProperties,
  tile: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "16px 18px",
  } satisfies CSSProperties,
  tileHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  } satisfies CSSProperties,
  tileLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  tileValue: { fontSize: 26, fontWeight: 700, display: "flex", alignItems: "baseline", gap: 3 } satisfies CSSProperties,
  tileValueSuffix: { fontSize: 15, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  tileEmpty: { fontSize: 15, fontWeight: 600, color: "var(--text-muted)" } satisfies CSSProperties,

  panelsRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
  } satisfies CSSProperties,
  panel: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  panelHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 0",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  agentIconBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  agentName: { fontSize: 13.5, fontWeight: 600, flex: 1 } satisfies CSSProperties,
  agentOpen: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--accent-text)",
    textDecoration: "none",
  } satisfies CSSProperties,
  emptyNote: { fontSize: 13, color: "var(--text-muted)", padding: "6px 0" } satisfies CSSProperties,

  donutRow: { display: "flex", alignItems: "center", gap: 20 } satisfies CSSProperties,
  legend: { display: "flex", flexDirection: "column", gap: 8, flex: 1 } satisfies CSSProperties,
  legendRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 } satisfies CSSProperties,
  legendSwatch: (color: string): CSSProperties => ({
    width: 9,
    height: 9,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
  }),
  legendLabel: { color: "var(--text-secondary)", flex: 1 } satisfies CSSProperties,
  legendCount: { color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,
} as const;
