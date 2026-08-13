import type { CSSProperties } from "react";

export const s = {
  metaRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 16 } satisfies CSSProperties,
  description: { fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.5 } satisfies CSSProperties,
  bodyBox: {
    padding: 16,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 13,
  } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "space-between", gap: 10 } satisfies CSSProperties,
  untrustedNotice: {
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
