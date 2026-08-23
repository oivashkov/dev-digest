import type { CSSProperties } from "react";

/** Co-located styles for BlastRadiusGraph. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  captionRow: {
    display: "flex",
    justifyContent: "flex-end",
    fontSize: 11,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  svg: {
    width: "100%",
    height: "auto",
    display: "block",
  } satisfies CSSProperties,
  edge: {
    fill: "none",
    stroke: "var(--border-strong)",
    strokeWidth: 1.25,
  } satisfies CSSProperties,
  nodeLabel: {
    fontSize: 11,
    fill: "var(--text-secondary)",
  } satisfies CSSProperties,
  legendRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 14,
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  } satisfies CSSProperties,
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    display: "inline-block",
  } satisfies CSSProperties,
} as const;

/** Node fill/stroke — `changed symbol` and `endpoint` columns get an accent
   outline (per the mockup), the `caller` column stays plain. */
export const NODE_COLOR = {
  symbol: { fill: "var(--accent-bg)", stroke: "var(--accent)" },
  caller: { fill: "var(--bg-hover)", stroke: "var(--border-strong)" },
  endpoint: { fill: "var(--accent-bg)", stroke: "var(--accent)" },
} as const;
