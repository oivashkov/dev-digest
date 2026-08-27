import type { CSSProperties } from "react";

/** Co-located styles for AgentDashboardCard — a single collapsed, clickable
   row (icon box, name + model badge, subtitle, right-aligned sparkline +
   three colored metric numbers, trailing chevron). */
export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "14px 18px",
    cursor: "pointer",
  } satisfies CSSProperties,
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  info: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  nameRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  name: {
    fontSize: 15,
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  metricsRight: { display: "flex", alignItems: "center", gap: 14, flexShrink: 0 } satisfies CSSProperties,
  metricNum: (color: string): CSSProperties => ({
    fontSize: 14,
    fontWeight: 700,
    color,
    minWidth: 40,
    textAlign: "right",
  }),
  chevron: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
} as const;
