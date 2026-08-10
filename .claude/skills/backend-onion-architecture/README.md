# Backend Onion Architecture Skill

## Motivation

`server/` already has a real Onion/ports-and-adapters layering — it just
isn't named or applied consistently. `repos`, `reviews`, `agents`, and
`repo-intel` each split cleanly into `routes.ts` → `service.ts` →
`repository.ts`, with external I/O going through `src/adapters/*` behind
`src/platform/container.ts` (a DI composition root). `repos/routes.ts` even
carries the literal comment *"Transport layer only... delegates all business
logic to RepoService."* `server/README.md` already diagrams the same flow.

The gap: `settings`, `polling`, `pulls`, and `workspace` skip the split
entirely and query `container.db` straight from `routes.ts`. Nothing named
the pattern, so nothing could be enforced against it — new modules (or new
logic added to the four thin ones) had no rule pointing them at
`service.ts`/`repository.ts`. This skill names the pattern using
dev-digest's own file names, states the dependency-direction rule as
something reviewable, and calls out the four modules that need to close the
gap before they grow further.

Like `frontend-architecture`, this skill is project-specific: it codifies
what `server/` already (mostly) does, and cites Onion Architecture theory
and this stack's ecosystem practices as rationale — not as an external
standard being imposed from scratch.

## Sources

### Internal (primary — the pattern already exists, just unnamed)

- `server/README.md` — Mermaid request/DI flow diagram: routes → service →
  container → adapters (ports); service → Drizzle → Postgres.
- `server/AGENTS.md` — "External I/O goes through an adapter behind the DI
  container... VCS resolution only via `container.vcsFor(repo)`, never
  adapters called directly from routes."
- `server/INSIGHTS.md` — 2026-07-31 decision, "schema-first validation at
  the boundary" — the recorded rationale for treating Zod schemas as the
  domain model (see Accepted Deviations in SKILL.md).
- `src/modules/repo-intel/README.md` — the one module that already
  documents its own layering (types → service facade → pipeline →
  repository → routes); model for how this skill talks about layers.
- Direct code, all still current as of this skill's creation:
  `src/modules/repos/routes.ts` ("Transport layer only" comment),
  `src/modules/repos/service.ts` ("No HTTP and no raw SQL live here"
  comment), `src/modules/reviews/repository.ts` ("The ONLY layer touching
  the DB for the review domain" comment), `src/platform/container.ts`
  (composition root, `vcsFor()`), `src/vendor/shared/adapters.ts` +
  `contracts/findings.ts` (Zod's dual role as validation + domain type).

### Onion Architecture — origin & theory

- [Jeffrey Palermo — The Onion Architecture: part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) — the original 2008 post; the "all coupling is toward the center" rule this skill's Dependency Direction section restates.
- [herbertograca.com — Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/) — clear layer-by-layer breakdown and its relation to Ports & Adapters.

### Onion vs. Clean vs. Hexagonal

- [Eric Damtoft — Onion vs Clean vs Hexagonal Architecture](https://medium.com/@edamtoft/onion-vs-clean-vs-hexagonal-architecture-9ad94a27da91) — practical comparison; dev-digest's shape (named layers + explicit ports/adapters) sits between Onion and Hexagonal.

### Node/TypeScript/Fastify-specific implementation

- [Remo Jansen — Implementing the Onion Architecture in Node.js with TypeScript and InversifyJS](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad) — SOLID + DI in a Node onion setup; contrasted with dev-digest's simpler hand-rolled `container.ts` in "Rejected / Deferred."
- [fastify/fastify-awilix](https://github.com/fastify/fastify-awilix) — the official Fastify DI plugin; cited as the fallback option if `container.ts` wiring ever becomes painful, not a required change.
- [thaitype/typescript-clean-architecture](https://github.com/thaitype/typescript-clean-architecture) — reference template for layer/folder naming conventions.

### Repository pattern with Drizzle

- [Sentry Blog — Atomic Repositories in Clean Architecture and TypeScript](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/) — repository pattern rationale and transaction boundaries; matches `reviews/repository/{pull,review,run}.repo.ts` splitting by aggregate.

### Zod + domain layer tension (justifies our accepted deviation)

- [colinhacks/zod — issue #813, "How to use zod in a clean architecture setup?"](https://github.com/colinhacks/zod/issues/813) — an open, unresolved community discussion on the exact tension dev-digest has already decided: framework-agnostic entities vs. Zod-as-source-of-truth. Cited to show this is a known trade-off, not an oversight.
- [Khalil Stemmler — Better Software Design with Application Layer Use Cases](https://khalilstemmler.com/articles/enterprise-typescript-nodejs/application-layer-use-cases/) — Use Cases/Application Services terminology; maps directly onto `service.ts`.

### Pragmatism / avoiding over-engineering

- Surveyed consensus across multiple Node.js Clean Architecture write-ups (searched, no single canonical source) converges on: don't apply Onion/Clean "100% by the book" — adapt to what the project actually needs. Cited to support the "Rejected / Deferred" section (no full DDD, no DI framework swap) rather than maximalist layering.

### Meta: how this skill itself was authored

- [Anthropic — Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — same authoring rules applied to `frontend-architecture`: third-person what+when description, SKILL.md under 500 lines, references one level deep, avoid duplicating what Claude already knows.

## Version

**0.1.0** (2026-08-10) — initial version. Layer map, dependency-direction
rule, and the four-module gap list cross-checked directly against
`server/src/modules/*` at write time. Not yet validated against real
review/authoring usage — expect revisions once exercised, and re-check the
gap list (`settings`, `polling`, `pulls`, `workspace`) periodically since
fixing it is the point of this skill.
