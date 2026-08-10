import type { CSSProperties } from "react";

/** Co-located styles for the PR detail view (extracted from inline styles). */
export const s = {
  loadingWrap: {
    padding: "28px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 1080,
    margin: "0 auto",
  } satisfies CSSProperties,
  contentWrap: {
    padding: "24px 32px 44px",
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 1080,
    margin: "0 auto",
  } satisfies CSSProperties,
};
