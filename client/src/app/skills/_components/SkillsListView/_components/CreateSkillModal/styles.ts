import type { CSSProperties } from "react";

export const s = {
  body: { display: "flex", flexDirection: "column" } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;
