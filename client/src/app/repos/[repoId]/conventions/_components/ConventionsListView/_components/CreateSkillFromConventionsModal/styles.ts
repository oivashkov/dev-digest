import type { CSSProperties } from "react";

export const s = {
  body: { display: "flex", flexDirection: "column", padding: "20px 24px" } satisfies CSSProperties,
  banner: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--accent)",
    background: "var(--accent-bg, var(--bg-hover))",
    color: "var(--text-secondary)",
    fontSize: 13,
    lineHeight: 1.5,
    marginBottom: 20,
  } satisfies CSSProperties,
  enabledRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  } satisfies CSSProperties,
  enabledLabel: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  enabledHint: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  tokenCount: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;
