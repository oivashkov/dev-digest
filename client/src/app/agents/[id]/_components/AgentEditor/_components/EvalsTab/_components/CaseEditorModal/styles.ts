import type { CSSProperties } from "react";

/** Co-located styles for CaseEditorModal. */
export const s = {
  body: { padding: 24 } satisfies CSSProperties,
  tabStrip: { display: "flex", gap: 4, marginBottom: 12, borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  tabBtn: (active: boolean): CSSProperties => ({
    padding: "8px 12px",
    border: "none",
    background: "transparent",
    borderBottom: "2px solid " + (active ? "var(--accent)" : "transparent"),
    marginBottom: -1,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
  }),
  runOnSaveRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  } satisfies CSSProperties,
  warningBox: {
    marginTop: 14,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 12.5,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  lastRunNote: { fontSize: 12.5, color: "var(--text-secondary)", marginTop: 12 } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
} as const;
