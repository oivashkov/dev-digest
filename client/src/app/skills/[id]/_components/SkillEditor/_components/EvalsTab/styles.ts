import type { CSSProperties } from "react";

/** Co-located styles for the EvalsTab placeholder. */
export const s = {
  wrap: {
    maxWidth: 480,
    margin: "40px auto 0",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    background: "var(--bg-hover)",
    color: "var(--text-muted)",
    display: "grid",
    placeItems: "center",
    marginBottom: 6,
  } satisfies CSSProperties,
  title: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  body: { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
} as const;
