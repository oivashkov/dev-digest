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
  scopeDrift: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 10,
    borderRadius: 8,
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  scopeDriftTitle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 700,
    color: "var(--warn)",
  } satisfies CSSProperties,
  scopeDriftHint: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  scopeDriftList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } satisfies CSSProperties,
  scopeDriftItem: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
