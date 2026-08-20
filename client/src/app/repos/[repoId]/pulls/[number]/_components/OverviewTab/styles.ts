import type { CSSProperties } from "react";

export const s = {
  /* Vertical rhythm between Description / IntentCard / BlastRadiusCard —
     each renders its own `<section>` with no built-in top/bottom margin. */
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
