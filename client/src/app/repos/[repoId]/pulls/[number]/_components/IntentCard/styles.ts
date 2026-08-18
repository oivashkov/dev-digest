import type { CSSProperties } from "react";

/** Co-located styles for IntentCard. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  body: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  listLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  chipsRow: { display: "flex", flexWrap: "wrap", gap: 6 } satisfies CSSProperties,
  refList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } satisfies CSSProperties,
  refItem: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  skeletonStack: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
} as const;
