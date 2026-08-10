# Frontend Architecture Skill

## Motivation

Neither existing frontend skill answered "where does this file go?":
`react-best-practices` has only a 9-line "Code Organization" section (hooks,
state, and render anti-patterns are its real focus), and `next-best-practices`
covers Next.js *routing* file conventions (`page.tsx`, RSC boundaries,
Server Actions) rather than component/file architecture. Meanwhile
dev-digest's `client/` already has consistent, deliberate conventions for
component location, decomposition, constants, and business-logic placement —
they just weren't written down anywhere as an explicit, agent-facing rule
set. This skill closes that gap without duplicating the two existing ones;
see the "Not covered here" pointers in [SKILL.md](SKILL.md).

This skill is **project-specific**, not a generic React guide: it codifies
dev-digest's actual `client/src` conventions first, and cites external
best-practice sources second, as rationale for why those conventions hold up
(or as the named alternative that was deliberately not adopted).

## Sources

### Internal (primary — dev-digest already answers most of this)

- `client/AGENTS.md` — pages-stay-thin rule, `_components/` colocation,
  the "components never call `fetch` directly" data rule.
- `client/README.md` — same rules in prose, plus the package map.
- `client/INSIGHTS.md` — recorded gotchas that affect composition (e.g. grid
  row components must not `return null` for empty state).
- `client/docs/README.md`, `client/specs/README.md` — where deeper docs and
  per-feature specs live; specs reference `src/app/**/page.tsx` and
  `src/lib/hooks` directly, confirming those as the canonical layers.
- `.claude/skills/next-best-practices/data-patterns.md` and
  `file-conventions.md` — the generic Next.js decision tree this skill
  explicitly does *not* re-derive, and against which dev-digest's actual
  (deviating) practice is contrasted.
- `.claude/skills/react-best-practices/SKILL.md` — the existing "Code
  Organization" section this skill supersedes for structural questions.
- Direct inspection of `client/src` (component folder shapes, `'use client'`
  usage across `src/app`, absence of `utils/`/`services/`/route groups) —
  not written down anywhere before this skill.

### Official / canonical

- [react.dev — Thinking in React](https://react.dev/learn/thinking-in-react) — component breakdown by single responsibility; matching the component tree to the data model.
- [nextjs.org — Project Structure](https://nextjs.org/docs/app/getting-started/project-structure) — App Router is unopinionated beyond routing files; colocation is sanctioned.
- [nextjs.org — Project Organization & Colocation](https://nextjs.org/docs/13/app/building-your-application/routing/colocation) — private folders (`_folder`), the mechanism behind dev-digest's `_components/`.
- [nextjs.org/learn — Server and Client Components](https://nextjs.org/learn/react-foundations/server-and-client-components) — official framing of the Server/Client boundary as the core App Router architectural decision.
- [nextjs.org/docs — File-system conventions: Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) — reference for if/when dev-digest's domains stop mapping 1:1 to URL segments.
- [nextjs.org/docs — Guides: Data Security](https://nextjs.org/docs/app/guides/data-security) and [nextjs.org/blog — How to Think About Security in Next.js](https://nextjs.org/blog/security-nextjs-server-components-actions) — the official Data Access Layer pattern (centralize all data access in one server-only module); direct precedent for `src/lib/api.ts` + `src/lib/hooks/*`, even though dev-digest's version fronts an external API rather than a database.

### Architecture guides

- [bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — feature-based structure; don't import across features, compose at the app level.
- [Feature-Sliced Design — docs](https://feature-sliced.design/docs) and [The Ultimate Next.js App Router Architecture](https://feature-sliced.design/blog/nextjs-app-router-guide) — layered slices/segments with strict dependency direction; cited as the deliberately-not-adopted heavier alternative.
- [Alex Kondov — Tao of React](https://alexkondov.com/tao-of-react/) — module/route-based grouping over a generic container/component split; matches dev-digest's page-scoped `_components/`.
- [Robin Wieruch — React Folder Structure Best Practices](https://www.robinwieruch.de/react-folder-structure/) — "start with `components/`, `hooks/`, `utils/` or `lib/`, grow as the codebase tells you to."
- [Josh Comeau — Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/) — colocated per-component folders with a barrel `index.js` — the same shape dev-digest already uses.
- [Kent C. Dodds — State Colocation will make your React app faster](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster) — colocation principle; direct backing for `_components/*/constants.ts` and `helpers.ts`.
- [Vercel Academy — Client-Server Component Boundaries](https://vercel.com/academy/nextjs-foundations/client-server-boundaries) — "push the boundary down the tree"; explains why dev-digest's client-heavy views are the correct shape given no server-side DB.

### Component design / patterns

- [patterns.dev — Presentational and Container Pattern](https://www.patterns.dev/react/presentational-container-pattern/) — pattern definition and history.
- [Dan Abramov — Presentational and Container Components](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0) — his own later retraction: "I don't suggest splitting your components like this anymore" — hooks replace the need for wrapper containers. Direct justification for dev-digest having no container components.
- [Airbnb React/JSX Style Guide](https://github.com/airbnb/javascript/blob/master/react/README.md) — one component per file, ordering conventions.
- [Atomic Design in React — CodeBrahma](https://codebrahma.com/atomic-design-react-component-structure-guide/) (representative of the broader atomic-design literature surveyed) — classification overhead (atom vs. molecule disputes) and loss of domain context; cited as the rejected alternative.

### Constants / utils / helpers / business logic

- [`utils` vs. `helpers` naming discussion](https://github.com/erikras/react-redux-universal-hot-example/issues/808) — utils = generic/project-agnostic, helpers = project-specific; matches dev-digest's `src/lib/*` vs. per-component `helpers.ts` split exactly.
- [TkDodo's Blog](https://tkdodo.eu/blog/) (TanStack Query maintainer) — practical guidance on structuring query hooks/keys per domain; `src/lib/hooks/` is already organized by domain file the way TkDodo recommends.

### Meta: how this skill itself was authored

- [Anthropic — Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — description must state what+when in third person; SKILL.md under 500 lines with progressive disclosure into separate files; references one level deep; avoid duplicating what Claude already knows.
- [Anthropic — Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) — frontmatter schema (`name`, `description` required; naming/length constraints).

## Version

**0.1.0** (2026-08-10) — initial version. Component location/decomposition,
constants, utils/helpers, business logic, and Next.js App Router boundary
rules, all cross-checked against `client/src` directly. Not yet validated
against real usage (see Anthropic's "build evaluations first" guidance) —
expect revisions once this is exercised in actual reviews/tasks.
