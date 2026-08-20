import type { CSSProperties } from "react";

/** Co-located styles for BlastRadiusCard. */
export const s = {
  body: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  skeletonStack: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
  } satisfies CSSProperties,
  statsRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 14,
  } satisfies CSSProperties,
  stat: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  statCount: { fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  viewSwitch: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    padding: 2,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  /** `Button`'s `ghost` kind doesn't vary with `active` — override so the
     selected Tree|Graph segment is visually distinct. */
  viewButtonActive: {
    background: "var(--bg-hover)",
    color: "var(--text-primary)",
    borderColor: "transparent",
  } satisfies CSSProperties,
  statusBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 8,
    background: "var(--warn-bg)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
