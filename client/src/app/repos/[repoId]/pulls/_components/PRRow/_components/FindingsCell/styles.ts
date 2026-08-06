import type { CSSProperties } from "react";

/** Co-located styles for FindingsCell and its per-severity tooltip. */
export const s = {
  wrap: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  dash: { color: "var(--text-muted)" } satisfies CSSProperties,
  tooltipList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  tooltipItem: {
    paddingTop: 10,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  tooltipItemFirst: { paddingTop: 0, borderTop: "none" } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  } satisfies CSSProperties,
  rationale: {
    marginTop: 6,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
