import type { CSSProperties } from "react";

/** Co-located styles for VersionsTab. */
export const s = {
  wrap: { maxWidth: 900 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-muted)", marginBottom: 18 } satisfies CSSProperties,

  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    marginBottom: 10,
  } satisfies CSSProperties,
  rowBody: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  rowSummary: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  rowDate: { fontSize: 12, color: "var(--text-muted)", marginTop: 3 } satisfies CSSProperties,
  rowActions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } satisfies CSSProperties,

  diffBox: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
    lineHeight: 1.6,
    borderRadius: 6,
    overflow: "hidden",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  diffLine: (type: "same" | "add" | "remove"): CSSProperties => ({
    padding: "1px 12px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    background: type === "add" ? "var(--code-add)" : type === "remove" ? "var(--code-del)" : "transparent",
    color: type === "add" ? "var(--code-add-text)" : type === "remove" ? "var(--code-del-text)" : "var(--text-secondary)",
  }),
  diffMarker: { display: "inline-block", width: 14, opacity: 0.7 } satisfies CSSProperties,
} as const;
