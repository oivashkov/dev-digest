import type { CSSProperties } from "react";

/** Co-located styles for CompareRunsModal. */
export const s = {
  body: { padding: 24 } satisfies CSSProperties,
  metricsTable: { width: "100%", borderCollapse: "collapse", marginBottom: 20 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    padding: "6px 10px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: { padding: "8px 10px", fontSize: 14, borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  tdMono: {
    padding: "8px 10px",
    fontSize: 14,
    borderBottom: "1px solid var(--border)",
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,

  promptSection: { marginTop: 20 } satisfies CSSProperties,
  sectionTitle: { fontSize: 14, fontWeight: 700, marginBottom: 10 } satisfies CSSProperties,
  identicalNote: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  diffBox: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
    lineHeight: 1.6,
    borderRadius: 6,
    overflow: "auto",
    maxHeight: 280,
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  diffLine: (type: "same" | "add" | "remove"): CSSProperties => ({
    padding: "1px 12px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    background: type === "add" ? "var(--code-add)" : type === "remove" ? "var(--code-del)" : "transparent",
    color: type === "add" ? "var(--code-add-text)" : type === "remove" ? "var(--code-del-text)" : "var(--text-secondary)",
  }),

  promoteRow: { display: "flex", gap: 10, marginTop: 20 } satisfies CSSProperties,
  promoteHint: { fontSize: 12, color: "var(--text-muted)", marginTop: 6 } satisfies CSSProperties,
} as const;
