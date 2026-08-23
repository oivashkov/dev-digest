import type { CSSProperties } from "react";

/** Co-located styles for OnboardingTourView — header + rail/content grid,
 *  mirroring ProjectContextView's page/header shape. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1200, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 8 } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  headerActions: { display: "flex", gap: 8, flexShrink: 0 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repoName: { color: "var(--accent-text)" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,

  note: {
    marginTop: 14,
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    border: "1px solid var(--warn-border, var(--border))",
    background: "var(--warn-bg)",
    color: "var(--warn)",
  } satisfies CSSProperties,

  body: {
    display: "grid",
    gridTemplateColumns: "220px 1fr",
    gap: 16,
    alignItems: "start",
    marginTop: 18,
  } satisfies CSSProperties,

  rail: {
    position: "sticky",
    top: 16,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: "8px 0",
  } satisfies CSSProperties,
  railTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    padding: "6px 14px",
  } satisfies CSSProperties,
  railItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 14px",
    fontSize: 13,
    color: "var(--text-secondary)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,

  sections: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,

  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
    overflow: "hidden",
    scrollMarginTop: 16,
  } satisfies CSSProperties,
  cardHeader: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "13px 16px",
    cursor: "pointer",
    color: "var(--text-primary)",
    background: "none",
    border: "none",
    textAlign: "left",
  } satisfies CSSProperties,
  cardTitle: { fontWeight: 600, fontSize: 14, flex: 1 } satisfies CSSProperties,
  cardBody: { padding: "0 16px 16px", fontSize: 14 } satisfies CSSProperties,

  links: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 } satisfies CSSProperties,

  loadingStack: { display: "flex", flexDirection: "column", gap: 12, marginTop: 18 } satisfies CSSProperties,
} as const;
