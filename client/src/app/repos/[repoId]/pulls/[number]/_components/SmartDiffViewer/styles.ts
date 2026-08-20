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
  fileRow: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  /** Row of per-finding severity badges rendered above a file's FileCard —
   *  one badge per finding (not a single aggregate count). FileCard's own
   *  header badge (`diff-viewer/FileCard`) is decorative/non-interactive by
   *  design, so this is a SmartDiffViewer-owned control: each badge scrolls
   *  to its finding's line and opens its `FindingCard`. */
  findingBadgeRow: {
    display: "flex",
    flexWrap: "wrap",
    alignSelf: "flex-start",
    gap: 6,
  } satisfies CSSProperties,
  findingBadgeButton: {
    display: "inline-flex",
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
