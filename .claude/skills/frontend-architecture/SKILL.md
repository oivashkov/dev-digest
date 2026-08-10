---
name: frontend-architecture
description: "Documents where React/Next.js code lives in dev-digest's client/ app: component location and folder shape, constants vs. utils vs. helpers, business-logic and data-fetching placement, and the App Router Server/Client Component split. Use when creating, moving, or reviewing files under client/src, deciding where a new component, hook, constant, or helper belongs, or splitting up a large component or page. Does not cover React hooks/state/performance anti-patterns (see react-best-practices) or Next.js routing file conventions, RSC boundaries, or data-fetching mechanics (see next-best-practices)."
version: 0.1.0
---

# Frontend Architecture & Code Organization

Where things live in `client/src`, and why. Codifies dev-digest's existing
(previously undocumented) conventions — this is not a generic React guide.
For code examples, see [examples.md](examples.md). For every source this
skill draws on, see [README.md](README.md).

## Scope

- **Covered here**: component location, component decomposition, constants,
  utils vs. helpers, business-logic/data-fetching placement, Server/Client
  Component split as it applies to this app.
- **Not covered here** — read the sibling skill instead:
  - Hooks rules, state management, memoization, render anti-patterns →
    `react-best-practices`.
  - Next.js routing files, RSC mechanics, Server Actions, Route Handlers,
    metadata, image/font optimization → `next-best-practices`.

## Component Location

- **Page-scoped** feature logic → colocated `_components/<Name>/` next to
  the route that uses it. The `_` prefix excludes it from routing.
- **Cross-route shared** components → `src/components/*` (e.g. `app-shell`,
  `diff-viewer`, `hover-popover`).
- **Vendored UI primitives** → `src/vendor/ui` (`@devdigest/ui`). Do not
  modify — treat as an external library.
- Pages (`src/app/**/page.tsx`) stay thin: import and render one view
  component, nothing else.

## Component Decomposition

Standard folder shape per component (observed consistently across
`FindingCard/`, `RunTraceDrawer/`, `AgentEditor/`, `PRRow/`):

| File | Purpose |
|---|---|
| `ComponentName.tsx` | The component |
| `ComponentName.test.tsx` | Colocated Vitest + RTL test |
| `styles.ts` | Style objects for this component |
| `constants.ts` | Component-local constants |
| `helpers.ts` | Component-local pure helper functions |
| `index.ts` | Barrel — re-exports only the public surface |
| `_components/<SubName>/` | Nested children, same shape recursively |

- When a component outgrows one file, split it into `_components/<SubName>/`
  — don't grow a god-file. This nests up to 3 levels deep in practice.
- The barrel `index.ts` keeps the public surface narrow: e.g.
  `diff-viewer/index.ts` exports only `DiffViewer` + `DiffCommentApi`
  despite many internal sub-components.
- One component per file; small colocated internal helpers are fine.

## Constants

- `constants.ts` is colocated with the component or route it configures.
  There is no global constants file.
- Route-level constants (shared by everything under one route) live in
  `constants.ts` at the route folder root, e.g.
  `src/app/repos/[repoId]/pulls/constants.ts`.
- Design tokens for vendored primitives live in
  `src/vendor/ui/primitives/tokens.ts` — reuse them, don't recreate values.

## Utils vs. Helpers

No `utils/` folder exists in this codebase. Two tiers instead:

- **`helpers.ts`**, colocated with a component — pure functions used only by
  that component (e.g. `FindingCard/helpers.ts`).
- **`src/lib/*.ts`**, flat (not a `utils/` subfolder) — generic, app-wide
  helpers reusable across features: `format.ts`, `vcs-urls.ts`,
  `model-label.ts`, `types.ts`.

Promote a component-local helper to `src/lib/` only once a second, unrelated
component needs it — don't pre-emptively generalize.

## Business Logic & Data Fetching

- ALL data access goes through a hook in `src/lib/hooks/*`, which calls
  `src/lib/api.ts`. Components NEVER call `fetch` directly.
- Hooks are organized by domain file (`agents.ts`, `reviews.ts`, `trace.ts`,
  `repo-intel.ts`, `core.ts`), re-exported via `src/lib/hooks/index.ts`.
- Server state is TanStack Query — never mirrored into `useState`.
- No `services/` or `actions/` directories exist anywhere under `client/src`
  — the hooks layer IS the business-logic layer.
- Cross-cutting client state (theme, toasts, repo context) lives as a React
  context/provider directly in `src/lib/*.tsx`, not inside a component
  folder.
- Types for API payloads come from `@devdigest/shared`
  (`src/vendor/shared`) — never redeclare them.

## Next.js App Router Specifics

- Pages are thin Server Components; the view underneath is almost always
  `'use client'`. This app has no server-side database — all data comes
  from a separate Fastify API via TanStack Query, which requires client
  execution (cache, refetch, mutations). Pushing the Server/Client boundary
  up doesn't buy anything here; don't "fix" this by trying to fetch inside a
  Server Component.
- No route groups. Top-level domain folders (`agents/`, `repos/`,
  `settings/`, `onboarding/`) already map 1:1 to URL segments.
- No Server Actions, no local Route Handlers under `src/app/api/`.
  `next-best-practices`' data-fetching decision tree (Server Component fetch
  → Server Actions → Route Handlers) does not apply to this client — it only
  talks to the external Fastify API through hooks.

## Rejected Alternatives

Documented so they aren't re-proposed without context:

- **Atomic design** (atoms/molecules/organisms) — not used. Classification
  overhead (is this a molecule or an organism?) outweighs the benefit at
  this scale. The three-tier split (`_components/` → `src/components/` →
  `src/vendor/ui`) already gives reuse without the taxonomy.
- **Container/presentational components** — not used. Hooks
  (`src/lib/hooks/*`) replace the need for wrapper container components;
  see README for the pattern's own retraction by its originator.
- **Feature-Sliced Design's full layered/segmented structure** — heavier
  than needed. Dev-digest's flatter colocation already gives the main
  benefit (features don't import each other) without FSD's layer/segment
  ceremony.
