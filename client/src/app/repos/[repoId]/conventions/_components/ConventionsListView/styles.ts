import type { CSSProperties } from "react";

/** Co-located styles for ConventionsListView — mirrors SkillsListView's page/header shape. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 900, margin: "0 auto" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 8,
  } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repoName: { color: "var(--accent-text)" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  meta: { fontSize: 13, color: "var(--text-muted)", marginTop: 10 } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 18,
    marginBottom: 16,
    paddingBottom: 16,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  toolbarCount: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  toolbarSpacer: { flex: 1 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
