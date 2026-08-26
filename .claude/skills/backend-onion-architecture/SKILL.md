---
name: backend-onion-architecture
description: "Documents and enforces dev-digest's Onion Architecture layering in server/: routes.ts (presentation) -> service.ts (application/domain) -> repository.ts (data access) and adapters/* (infrastructure ports), wired through platform/container.ts. Use when creating a new backend module, reviewing a module for direct DB or adapter access from routes.ts, or deciding which layer a piece of business logic belongs in. Does not cover Fastify route/plugin mechanics (see fastify-best-practices), Drizzle query syntax (see drizzle-orm-patterns), or Postgres schema design (see postgresql-table-design)."
version: 0.2.0
---

# Backend Onion Architecture

`server/` already has a real (if partly undocumented and inconsistently
applied) Onion/ports-and-adapters layering. This skill names it, makes the
dependency-direction rule enforceable, and closes the gap in the modules
that skip it. For code examples, see [examples.md](examples.md). For every
source this skill draws on, see [README.md](README.md).

## Not to be confused with Fastify's "onion model"

Fastify's own docs use "onion model" for its request/response **hook
lifecycle** (`onRequest` → handler → `onSend`, nested like an onion). That is
unrelated to Onion Architecture, the layering pattern below. Don't conflate
the two when reviewing.

## The Layers

| Layer | dev-digest location | Rule |
|---|---|---|
| Presentation | `modules/<name>/routes.ts` | Parses the request, maps status codes, calls one or more `service.*` methods. No business logic, no DB calls, no adapter calls. |
| Application / domain | `modules/<name>/service.ts` (+ `helpers.ts`; `pipeline/*` for repo-intel) | Business rules and orchestration. Constructor takes `Container` (or, better, the specific repository/adapters it needs). MUST NOT import `fastify` or `FastifyInstance`/`FastifyRequest`. |
| Infrastructure — data access | `modules/<name>/repository.ts` (split into `repository/<aggregate>.repo.ts` for multi-aggregate modules, e.g. `reviews/repository/{pull,review,run}.repo.ts`) | The ONLY place `drizzle-orm` query building or `db.*` calls happen for that module's tables. |
| Infrastructure — ports & adapters | `src/adapters/*` implementing the interfaces declared in `@devdigest/shared`'s `adapters.ts` (`GitHubClient`, `GitLabClient`, `GitClient`, `LLMProvider`, `CodeIndex`, `Embedder`, `SecretsProvider`, `AuthProvider`, ...) | All external I/O — HTTP calls, git ops, LLM calls, signature/token verification. Never called directly from a route **or from `repository.ts`** — always through `container.<adapter>` or the resolver helper (e.g. `container.vcsFor(repo)`). Adapters translate and verify; they don't decide business outcomes — a branch on domain data (a threshold, a routing decision) belongs in `service.ts`. Swappable for `src/adapters/mocks.ts` in tests. |
| Composition root | `src/platform/container.ts` | Wires adapters + repositories into services. The one place allowed to know about every layer at once. |
| Shared kernel / domain contracts | `src/vendor/shared/contracts/*` (Zod) | Cross-cutting domain types (`Finding`, `Review`, `Severity`, ...), shared web ↔ api. Do not redeclare these locally. |

## Dependency Direction (MUST)

- Routes depend on services. Services depend on repositories/adapters
  (through the container). Never the reverse.
- `repository.ts` and `src/adapters/*` MUST NOT import from `routes.ts` or
  from `fastify`.
- `service.ts` MUST NOT import `FastifyInstance`/`FastifyRequest` — if a
  service needs request-scoped data (workspace/user id), pass it as a plain
  argument, resolved in the route via `getContext()`.
- Only `service.ts` calls into `src/adapters/*` (through the container).
  `repository.ts` MUST NOT import or call an adapter directly — if a
  repository method needs external I/O (e.g. verifying a signature before a
  write), that orchestration belongs in the service; the repository stays a
  pure `db.*` boundary.
- `src/adapters/*` MUST NOT contain business rules — no branching on domain
  data (a confidence threshold, a status decision). An adapter's job is
  protocol/encoding translation and verification (parse a payload, check a
  signature, call an API) — deciding what that verified input *means* for
  the domain is `service.ts`'s job, not the adapter's.

## Every Module MUST Have the Three-Layer Split

`routes.ts` MUST NOT call `container.db` or import `drizzle-orm` directly.
A route reaching straight into the DB is the #1 violation to flag in review
— it's exactly how a module accumulates undocumented business logic in its
transport layer.

As of writing, four modules still do this and are debt, not the pattern to
copy: `settings`, `polling`, `pulls`, `workspace` — see
[examples.md](examples.md) for `polling/routes.ts`, which builds and runs
`drizzle-orm` queries, does upsert logic, and touches three tables, all
inside the route handler. Before adding new logic to one of these four,
extract a `service.ts` + `repository.ts` first; don't add another inline DB
call next to the existing ones.

New modules start with all three files (`routes.ts`, `service.ts`,
`repository.ts`) even if `service.ts` is thin at first. Don't defer the
split "because it's simple for now" — that deferral is how the four modules
above ended up flat.

## Accepted Deviations (do not "fix" these)

Two intentional departures from textbook Onion, already decided — cite this
skill/README, don't re-litigate:

1. **Domain types are Zod schemas, not framework-free entities.**
   `@devdigest/shared/contracts/*` schemas double as the domain model AND
   the validation/serialization layer. Recorded in `server/INSIGHTS.md` as
   the 2026-07-31 "schema-first validation at the boundary" decision. This
   is a known, debated trade-off in the wider TS/Zod community (see
   README) — dev-digest has already chosen the pragmatic side.
2. **`service.ts` holds a `Container` reference**, not narrowly-typed
   constructor-injected ports. Pragmatic and accepted for most modules.
   Where a service is complex or safety-critical, prefer depending on the
   specific repository/adapter it actually uses (repo-intel's
   `RepoIntelService` does this better than most) — but this is a
   preference, not a MUST.

## Rejected / Deferred

Considered, intentionally not adopted — don't re-propose without new
justification:

- **Full DDD** (aggregates, value objects, domain events) — heavier than
  this codebase needs. `service.ts` as an application-service facade is
  enough; see README for the Use-Case/Application-Service framing this maps
  to.
- **Replacing `platform/container.ts` with InversifyJS or `@fastify/awilix`**
  — the hand-rolled container works and is well understood by the team.
  Reconsider only if DI wiring itself becomes a real pain point.
- **Splitting `@devdigest/shared` contracts into separate framework-agnostic
  entity types** — rejected per the INSIGHTS.md decision above.

## Scope

- Not covered here: Fastify route/plugin/hook mechanics →
  `fastify-best-practices`. Drizzle query syntax, relations, transactions →
  `drizzle-orm-patterns`. Postgres schema/indexing →
  `postgresql-table-design`.
- This skill only adds: which layer a piece of logic belongs in, and the
  dependency-direction rule between those layers.
