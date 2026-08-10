# Skill scope map

The literal lookup `pr-self-review` consults to decide which skills apply to
which changed files. Read this file directly rather than re-deriving scope
from all 13 `SKILL.md` files on every run — that's slow and expensive.

**Maintenance**: this file goes stale whenever a skill is added, removed, or
rescoped in `.claude/skills/`. `pr-self-review`'s procedure runs a staleness
self-check (compares this table's skill names against the actual
`.claude/skills/*/SKILL.md` directory listing) and warns — but the fix is
manual: update the table below.

## Contents

- [Table: skill → file globs](#table-skill--file-globs)
- [Ownership rule for overlapping skills](#ownership-rule-for-overlapping-skills)
- [Excluded skills](#excluded-skills)
- [Dangling cross-references (no-ops)](#dangling-cross-references-no-ops)

## Table: skill → file globs

| Skill | Applies to (glob, this repo) |
|---|---|
| `backend-onion-architecture` | `server/src/modules/*/routes.ts`, `server/src/modules/*/service.ts`, `server/src/modules/*/repository.ts`, `server/src/modules/*/repository/*.repo.ts`, `server/src/adapters/**`, `server/src/platform/container.ts` |
| `fastify-best-practices` | `server/src/app.ts`, `server/src/server.ts`, `server/src/modules/*/routes.ts`, `server/src/platform/**` |
| `drizzle-orm-patterns` | `server/src/db/**`, `server/src/modules/*/repository.ts`, `server/src/modules/*/repository/*.repo.ts` — **only** these; never `routes.ts`/`service.ts` (onion architecture already owns "drizzle called from the wrong layer") |
| `postgresql-table-design` | `server/src/db/schema.ts`, `server/src/db/schema/*.ts` only — DDL/table definition, not query code |
| `frontend-architecture` | `client/src/app/**`, `client/src/components/**`, `client/src/lib/**` — excludes `client/src/vendor/**` |
| `react-best-practices` | `client/src/**/*.tsx`, hook files under `client/src/lib/hooks/**` — excludes `client/src/vendor/ui/**` and `*.test.tsx` |
| `next-best-practices` | `client/src/app/**` — `page.tsx`, `layout.tsx`, `error.tsx`, `not-found.tsx`, `loading.tsx`, route/App-Router convention files |
| `react-testing-library` | `client/src/**/*.test.tsx`, `client/src/**/*.test.ts` only |
| `zod` | any file defining/using `z.object`/`z.infer`/`safeParse` — `**/vendor/shared/contracts/**`, `server/src/modules/_shared/schemas.ts`, `server/src/platform/config.ts`, any `routes.ts` with an inline `schema.body`/`schema.params`, client form/schema files |
| `typescript-expert` | `**/*.ts`, `**/*.tsx` repo-wide — broadest net, runs alongside whichever domain skill(s) also match (see ownership rule) |
| `security` | cross-cutting: auth adapters (`server/src/adapters/auth/**`), any `routes.ts` doing auth/input handling, `server/src/platform/config.ts`, `server/src/app.ts` (CORS/headers/rate-limit setup). The skill's own examples assume Express + MongoDB — translate mentally to this repo's Fastify + Postgres/Drizzle stack; don't apply Mongoose/Express-specific sections literally. |
| `mermaid-diagram` | `**/*.md` only |

## Ownership rule for overlapping skills

A single file often matches several skills (e.g. `server/src/modules/repos/routes.ts`
matches `backend-onion-architecture`, `fastify-best-practices`, possibly
`zod` and `typescript-expert` at once). Each skill reports findings **only**
in its own lane, to avoid the same line getting flagged twice under
different names:

1. **backend-onion-architecture** — layering/dependency-direction violations
   only: a DB call in `routes.ts`, a service importing Fastify types, a
   module missing its `service.ts`/`repository.ts` split.
2. **fastify-best-practices** — route/plugin/schema/hook mechanics
   themselves (registration order, error handling, rate-limit config) —
   never business-logic placement (that's #1's job).
3. **drizzle-orm-patterns** — query/transaction correctness, but only
   reachable in `repository.ts`/`*.repo.ts` — a raw drizzle call anywhere
   else is already flagged by #1, don't also flag it here.
4. **postgresql-table-design** — schema/DDL correctness in `db/schema/*.ts`.
5. **zod** — schema definition/parsing correctness wherever Zod is used.
6. **frontend-architecture** — component location/decomposition/placement.
7. **react-best-practices** — hooks/state/render/memoization correctness
   inside a component — not where the component lives (that's #6).
8. **next-best-practices** — App Router file-convention/RSC-boundary
   correctness.
9. **react-testing-library** — test-file structure/assertions only.
10. **security** — auth/input/secrets/CORS concerns, cross-cutting.
11. **typescript-expert** — lowest priority. Only report a finding here if
    no more specific skill above already flagged the same file:line —
    otherwise skip it. This skill's net is intentionally the broadest, so
    it's the one most likely to produce noise if not capped this way.

## Excluded skills

- **`engineering-insights`** — not a review skill ("It does not review
  code" per its own SKILL.md). Never included in the mapping. `pr-self-review`
  does not touch `INSIGHTS.md` files.

## Dangling cross-references (no-ops)

Some skills reference sibling skills/subagents that don't exist in this
repo's `.claude/skills/`. Treat silently as no-ops — don't try to invoke
them, don't fail the run:

- `zod` → `react-hook-form` skill, `orval` skill (neither exists)
- `typescript-expert` → `typescript-build-expert`, `typescript-module-expert`,
  `typescript-type-expert` subagents (none exist)
