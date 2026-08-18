import type { CSSProperties } from "react";

/** Co-located styles for SmartDiffViewer. */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    padding: "2px 2px 0",
  } satisfies CSSProperties,
  groupLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-primary)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  } satisfies CSSProperties,
  groupDescription: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  groupFiles: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  fileRow: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  /** Clickable "N findings" affordance rendered above a file's FileCard —
   *  scrolls to the file's first finding line. FileCard's own header badge
   *  (`diff-viewer/FileCard`) is decorative/non-interactive by design, so this
   *  is a SmartDiffViewer-owned control, not a click handler bolted onto it. */
  jumpButton: {
    display: "inline-flex",
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 500,
    color: "var(--warn)",
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
