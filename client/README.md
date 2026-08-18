# `@devdigest/web` — the studio (Next.js 15)

The DevDigest UI: import repos, browse pull requests, run and read AI reviews,
and author agents + reusable Skills. App Router + React Server/Client
components, data via **TanStack Query** hooks over the Fastify API. (This is
the starter surface plus Skills Lab (L02) and the Intent Layer — the PR
detail page's `IntentCard` shows the classified intent/scope, the first piece
of the eventual `PrBrief`; Blast Radius, Risks, PR History, and Smart Diff are
still unbuilt future course lessons. Course lessons still add Memory, Eval,
multi-agent, CI, and dashboard screens.)

- **Stack:** Next.js 15 (App Router), React 19, TanStack Query, `next-intl`
  (messages in `messages/<locale>/*.json`), `recharts`, `mermaid`,
  `react-markdown`. UI primitives are vendored under `src/vendor/ui`
  (`@devdigest/ui`) and shared Zod contracts under `src/vendor/shared`
  (`@devdigest/shared`).
- **API base:** `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`), used by
  `src/lib/api.ts`. Every data hook lives in `src/lib/hooks/*`.
- **Run:** `pnpm dev` (`:3000`). **Test:** `pnpm test` (vitest + jsdom, fetch
  mocked — no API needed). **Typecheck:** `pnpm typecheck`.

## UI route map

Routes (`src/app/**/page.tsx`) and the API surface each leans on (via
`src/lib/hooks/*` → `src/lib/api.ts`):

```mermaid
flowchart TD
  ROOT["/"] -->|"useRepos → GET /repos"| PULLS["/repos/:repoId/pulls<br/>PR list"]
  ONB["/onboarding<br/>add repo"] -->|"POST /repos"| API[("Fastify API")]
  PULLS --> PR["/pulls/:number<br/>review detail<br/>(overview · diff · findings)"]

  AGENTS["/agents"] --> AGENT["/agents/:id<br/>editor (config · skills)"]
  SKILLS["/skills<br/>Skills Lab list"] --> SKILL["/skills/:id<br/>editor (config · preview · stats · versions)"]
  CONV["/repos/:repoId/conventions<br/>Conventions Lab — scan · accept/reject/edit · create skill"]
  SETTINGS["/settings/:section<br/>API keys · models"]

  PULLS -->|"GET /repos/:id/pulls · /repos/:id/index-state"| API
  PR -->|"GET /pulls/:id · /reviews · /pulls/:id/comments<br/>POST /pulls/:id/review · /findings/:id/(accept|dismiss)<br/>GET /pulls/:id/intent · POST /pulls/:id/intent/refresh"| API
  AGENTS -->|"/agents · /agents/:id · /agents/:id/skills"| API
  SKILLS -->|"/skills · /skills/:id · /skills/:id/versions · /:id/stats<br/>/skills/import/preview"| API
  CONV -->|"GET /repos/:id/conventions<br/>POST /repos/:id/conventions/extract · PATCH /conventions/:id"| API
  SETTINGS -->|"/settings · /providers"| API
```

Cross-cutting chrome lives in `src/components/app-shell` (nav, breadcrumbs,
`g`-then-key shortcuts). Pages are thin; feature logic sits in colocated
`_components/<Name>/` folders, each with its own `*.test.tsx`.

## Testing

Component/interaction tests (`*.test.tsx`) run under vitest + jsdom with `fetch`
mocked, so they need neither the API nor a browser. The real browser journeys
(client + API + seeded DB) are covered by the deterministic agent-browser suite
in [`../e2e`](../e2e/README.md) and the `e2e-web.yml` workflow. See
[`../TESTING.md`](../TESTING.md).
