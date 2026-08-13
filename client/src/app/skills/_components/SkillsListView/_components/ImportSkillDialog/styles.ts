import type { CSSProperties } from "react";

export const s = {
  body: { display: "flex", flexDirection: "column" } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
  dropzone: {
    border: "1.5px dashed var(--border-strong)",
    borderRadius: 8,
    padding: "28px 16px",
    textAlign: "center",
    color: "var(--text-muted)",
    fontSize: 13,
  } satisfies CSSProperties,
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 16,
  } satisfies CSSProperties,
  evidence: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,
  warning: {
    fontSize: 12,
    color: "var(--text-muted)",
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "8px 10px",
    marginBottom: 16,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  vettingNotice: {
    fontSize: 12,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
    borderRadius: 6,
    padding: "8px 10px",
    marginBottom: 16,
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
