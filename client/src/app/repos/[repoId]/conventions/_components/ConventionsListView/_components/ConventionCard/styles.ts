import type { CSSProperties } from "react";

/** Co-located styles for ConventionCard — mirrors FindingCard's card shape. */
export const s = {
  card: (accepted: boolean): CSSProperties => ({
    borderRadius: 8,
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderWidth: 1,
    borderLeftWidth: 3,
    borderLeftColor: accepted ? "var(--ok)" : "var(--border-strong)",
    background: "var(--bg-elevated)",
    padding: "14px 16px 16px",
  }),
  titleRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  } satisfies CSSProperties,
  titleMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  title: { fontSize: 14, fontWeight: 700, fontStyle: "italic" } satisfies CSSProperties,
  editBtn: { flexShrink: 0 } satisfies CSSProperties,
  actions: { display: "flex", gap: 8, marginTop: 14 } satisfies CSSProperties,
  evidence: {
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    overflow: "hidden",
    marginBottom: 12,
  } satisfies CSSProperties,
  evidenceHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
  } satisfies CSSProperties,
  evidenceCode: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 12.5,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
    overflowX: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,
  editForm: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 } satisfies CSSProperties,
  editActions: { display: "flex", gap: 8 } satisfies CSSProperties,
} as const;
