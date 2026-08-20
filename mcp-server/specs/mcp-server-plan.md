# Development Plan: Local MCP server for DevDigest (`mcp-server/`)

> Persisted spec for the `mcp-server/` package, produced by the `planner`
> subagent (revised once to enforce the project's onion-architecture
> layering — see §4). Read this before implementing any step.

## 1. Summary

Add a brand-new top-level package `mcp-server/` that exposes five MCP tools
(`list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`,
`get_blast_radius`) over stdio to any local MCP client, so an agent can list
reviewer agents, run a review end-to-end on a PR, read findings/conventions,
and probe a not-yet-built blast-radius feature. The server is a thin HTTP
client to the existing local Fastify API at `http://localhost:3001` — it
imports no server internals. Internally it follows an explicit three-layer
split (an MCP-adapted version of the project's `backend-onion-architecture`):
thin presentation tools → an application service → a single HTTP
infrastructure adapter, wired by one composition root. Every tool applies
the four reference-image practices (result-not-operation, flat args,
concise structured response, error-leads-forward) and general MCP hygiene
(verb_noun names, annotations, day-one pagination, structured `isError`).

## 2. Context reviewed

- `mcp-server/specs/`, `docs/`, `INSIGHTS.md` — none found (new package;
  §10 states where they should live).
- Root `AGENTS.md` — per-package `specs/` → `docs/` → `INSIGHTS.md` →
  source doc convention; new modules follow the same layout. Package-manager
  map (npm for standalone tool packages).
- `backend-onion-architecture` skill — presentation → application →
  infrastructure layering, dependency direction MUST flow inward, "a route
  calling straight into the DB/adapter is the #1 violation," and "new
  modules start with all three layers even if the service is thin." This
  plan's §4 adapts that rule to a DB-less/Fastify-less package.
- `TESTING.md:1-8, 26-34, 77-96` — one suite per package, own runner +
  path-filtered CI; hermetic-by-default, mock the outside world; "one real
  integration per data-backed workflow," self-skips when its external dep
  is absent.
- `server/README.md:65-94` — API map; confirms `GET /agents`,
  `GET /repos`, `GET /repos/:id/pulls`, `POST /pulls/:id/review`,
  `GET /pulls/:id/reviews`, `GET /repos/:id/conventions`. Lines 9-14
  confirm blast-radius is a future module.
- `server/src/modules/_shared/context.ts:19-33` — `getContext` uses
  `LocalNoAuthProvider` (default workspace + system user). **Confirms
  decision #2: the local API needs no auth/bearer.** Only rate-limiting
  applies (`server/README.md:59-61`).
- `server/src/modules/reviews/routes.ts:34-54` — **`POST /pulls/:id/review`
  is synchronous**: it `await`s `service.runReview` and returns
  `{ pr_id, runs, reviews }` with `reviews` already populated. Body is
  `RunRequest = { agentId?, all? }` (an agent **UUID**, not a name).
- `server/src/vendor/shared/contracts/review-api.ts:15-57` —
  `ReviewRecord` (`run_id`, `verdict`, `score`, `summary`,
  `findings: FindingRecord[]`), `ReviewRunResponse`.
- `server/src/vendor/shared/contracts/findings.ts:47-79` —
  `Finding`/`Review` shapes (the fields to trim from).
- `server/src/modules/pulls/routes.ts:22-30` — `GET /repos/:id/pulls →
  PrMeta[]`, `GET /pulls/:id → PrDetail`.
- `server/src/vendor/shared/contracts/platform.ts:156-203, 288-292` —
  `Repo` (`id`, `owner`, `name`, `full_name`, `provider`, `host`),
  `PrMeta` (`number`, `title`, …), `RunRequest`,
  `ApiErrorBody = { error: { code, message, details? } }`.
- `server/src/vendor/shared/contracts/knowledge.ts:269-284, 207-229` —
  `Agent` (`id`, `name`, `provider`, `model`, `enabled`, `version`,
  `strategy`, …), `ConventionsState`/`ConventionCandidate`.
- Existing package conventions: `reviewer-core/package.json`
  (`@devdigest/reviewer-core`, npm), `e2e/package.json` (`@devdigest/e2e`,
  npm); `reviewer-core/tsconfig.json:21-23` aliases `@devdigest/shared →
  ../server/src/vendor/shared/index.ts` and is consumed as TS source
  (never emits JS).

## 3. Modules affected

| Module | Package manager | Why touched |
|---|---|---|
| `mcp-server/` (new, top-level) | **npm** | The whole deliverable — new standalone tool package, matching `reviewer-core/`/`e2e/` npm convention. |
| `server/` | pnpm | **Not modified.** Consulted only as the HTTP API the MCP server calls, and as the source of `@devdigest/shared` contracts imported via tsconfig path alias (read-only). |

Package name `@devdigest/mcp-server`, directory `mcp-server/` at repo root.

## 4. Architectural constraints

**This package uses an MCP-adapted version of the project's
`backend-onion-architecture` skill.** The skill is scoped to `server/`, but
its principle — presentation → application → infrastructure, dependencies
pointing inward, no layer-skipping — carries over. Because this package has
no DB and no Fastify, the layers map as follows (recorded here so a future
architecture review has something concrete to check against):

| Onion layer (server/) | `mcp-server/` equivalent | Rule |
|---|---|---|
| Presentation — `modules/<name>/routes.ts` | `src/tools/*.ts` | Declares MCP `inputSchema`/`outputSchema`/`annotations`; the handler calls **exactly one** service method and maps the returned typed result (success or typed failure) to MCP content blocks / `isError`. **No `fetch`, no resolution logic, no trimming/pagination inline.** |
| Application / domain — `service.ts` | `src/service/**` | Repo/PR/agent resolution orchestration, the run+poll+timeout-fallback orchestration for `run_agent_on_pr`, and all trim/pagination shaping. **MUST NOT import `@modelcontextprotocol/sdk`** (the MCP-boundary equivalent of "`service.ts` MUST NOT import `FastifyInstance`/`FastifyRequest`"). Plain arguments in, plain typed results out (a discriminated success/failure ADT carrying the next-step message), so it is testable with zero MCP machinery. |
| Infrastructure — ports & adapters — `src/adapters/*` | `src/http/client.ts` (+ `src/http/errors.ts`) | The **only** place a `fetch` to the DevDigest API happens — the single port to the external system. Called **only** from `src/service/**`, never from `src/tools/*`. Swappable for a mock in tests, mirroring `src/adapters/mocks.ts`. |
| Composition root — `platform/container.ts` | `src/server.ts` | The one place that wires the HTTP client into the service and the service into the registered tools. The only module that knows every layer at once. |
| Shared kernel — `@devdigest/shared` contracts | same, via tsconfig alias | Domain contracts (`Agent`, `Finding`, `ReviewRecord`, …) reused read-only; never redeclared locally. |

**Dependency direction (MUST):** `tools/*` → `service/**` →
`http/client.ts`. Never the reverse; `http/*` and `service/**` must not
import from `tools/*` or from `@modelcontextprotocol/sdk`. New package
starts with all three layers present from the first commit even though the
presentation tools are thin — per the skill's "don't defer the split" rule,
which is exactly what this revision enforces.

Other constraints (unchanged):

- **Thin HTTP client only.** No import of `server/src/**` internals; the
  sole server-side dependency is `@devdigest/shared` via the tsconfig alias.
- **npm, not pnpm.** Own `package.json` + lockfile; never part of a
  workspace.
- **Do not touch** `server/src/vendor/**` (consume the alias, never edit),
  `server/clones/**`, lockfiles.
- **No contract change required.** If a shape genuinely needs a new field
  it changes in `@devdigest/shared` first — but this plan only reads
  existing ones.
- **Local/stdio only for v1.** Official `@modelcontextprotocol/sdk`,
  `StdioServerTransport`. No HTTP/SSE transport, no remote auth.
- **Server `instructions` vs tool `description` non-redundant.** Shared
  context lives once in `instructions`; each tool `description` states only
  *when to call it*.
- **Synchronous-review reality (flag).** `POST /pulls/:id/review` returns
  completed `reviews` in one call, so the service's poll loop is a
  **timeout fallback**, not the main path. The main path is one POST, read
  `reviews` from the response; polling `GET /pulls/:id/reviews` matters
  only if the HTTP client hits the 120s ceiling while the server keeps
  working.

## 5. Steps

### Step 1: Scaffold the `mcp-server/` package

- **Type:** core
- **Module/package:** `mcp-server/` (npm)
- **Owned paths (exclusive):** new: `mcp-server/package.json`,
  `mcp-server/tsconfig.json`, `mcp-server/.gitignore`,
  `mcp-server/README.md`, `mcp-server/.env.example`,
  `mcp-server/src/config.ts`
- **What changes:** Create the package: name `@devdigest/mcp-server`, npm
  scripts (`build` = typecheck-only `tsc --noEmit` per repo convention,
  `dev`, `test`, `typecheck`, `start`), deps `@modelcontextprotocol/sdk` +
  `zod`, tsconfig with the `@devdigest/shared` alias to
  `../server/src/vendor/shared/index.ts` (mirroring
  `reviewer-core/tsconfig.json`), strict mode on. `config.ts` reads
  `DEVDIGEST_API_URL` (default `http://localhost:3001`, matching
  `API_PORT`), poll interval (2s), hard timeout (120s), request timeout —
  all from env with defaults; this is the values the composition root will
  feed into the infra + service layers. README documents "start the API
  with `./scripts/dev.sh` first."
- **Skills the implementer will apply:** `typescript-expert`, `security`
  (no secrets baked in; base URL from env), `engineering-insights`
- **Depends on:** none
- **Tests to run/add:** `npm run typecheck`.

### Step 2: Infrastructure/adapter layer — DevDigest API HTTP client + error mapping

- **Type:** core
- **Module/package:** `mcp-server/` (npm)
- **Owned paths (exclusive):** new: `mcp-server/src/http/client.ts`,
  `mcp-server/src/http/errors.ts`, `mcp-server/src/http/types.ts`
- **What changes:** The single port to the external API — the only `fetch`
  site in the package (the `src/adapters/*` equivalent). A typed client
  class constructed with the base URL + request timeout: typed GET/POST
  helpers over the endpoints the service needs (`GET /agents`,
  `GET /repos`, `GET /repos/:id/pulls`, `POST /pulls/:id/review`,
  `GET /pulls/:id/reviews`, `GET /repos/:id/conventions`), each validating
  the response with the relevant `@devdigest/shared` schema via
  `safeParse` (per `zod` `parse-use-safeparse`,
  `parse-never-trust-json`). `errors.ts` defines a typed error taxonomy the
  service maps to next-step messages: `unreachable` (ECONNREFUSED → "start
  it with `./scripts/dev.sh`"), `rate_limited` (429), `not_found` (unwraps
  `ApiErrorBody.error.message`), `bad_response` (schema drift). The client
  returns typed data or throws/returns these typed errors — it does **not**
  know about MCP `isError` (that mapping is presentation's job). This layer
  never imports from `src/service/**`, `src/tools/*`, or the MCP SDK.
- **Skills the implementer will apply:** `zod`, `typescript-expert`
  (discriminated error union), `security` (`fetch(baseUrl)` from env is
  safe; no user-controlled URL), `engineering-insights`
- **Depends on:** Step 1
- **Tests to run/add:** Step 7 (mock `fetch`; assert typed errors + schema
  validation).

### Step 3: Application/service layer — resolution, orchestration, shaping (one entry point per tool)

- **Type:** core
- **Module/package:** `mcp-server/` (npm)
- **Owned paths (exclusive):** new: `mcp-server/src/service/index.ts` (the
  `McpService` facade), `mcp-server/src/service/resolve.ts`,
  `mcp-server/src/service/shape.ts`, `mcp-server/src/service/results.ts`
  (the success/failure ADT types)
- **What changes:** The application layer. `McpService` is constructed
  with the HTTP client port + run policy (poll interval, hard timeout) —
  constructor injection, the DI seam. It exposes **exactly one method per
  tool**, each taking plain scalar args and returning a typed result
  (`results.ts` discriminated union: `{ ok: true, data }` or
  `{ ok: false, failure: { kind, message } }`, where `message` is always
  next-step-oriented). **It MUST NOT import `@modelcontextprotocol/sdk`.**
  - `resolve.ts` (the old `resolve/identifiers.ts`, now internal to the
    service): auto-detects UUID vs `owner/repo`/URL (decision #1); repo
    via `GET /repos` filtered client-side by `full_name`/URL (no
    server-side lookup-by-name route), PR via `GET /repos/:id/pulls`
    filtered by `number`, agent name → UUID via `GET /agents`. Each
    failure yields a typed failure with practice-#4 messaging (repo not
    found → "…check the name, or import it first in the studio";
    distinguishes not-imported from a typo where possible; agent not
    found → "call `list_agents`").
  - `shape.ts` (the old `tools/shared/output.ts`): pure trim + pagination
    helpers shared by the read methods and `runAgentOnPr`.
  - Facade methods: `listAgents()` → trimmed agent list;
    `getConventions(repo, page?)` → resolve repo →
    `GET /repos/:id/conventions` → trimmed+paginated conventions (+ a
    not-yet-scanned message when `scan_status` is idle);
    `getFindings(repo, pr, runId?, page?, pageSize?)` → resolve repo+pr →
    `GET /pulls/:id/reviews` → pick review matching `runId` else most
    recent → trimmed+paginated findings. **Explicit no-reviews-yet
    failure (practice #4, closes a gap found during plan review):** if
    the PR has no completed reviews at all, return a typed
    `no_reviews_yet` failure with message *"No completed review found for
    this PR yet — call run_agent_on_pr to start one."*; if `runId` was
    given but doesn't match any review on this PR, return a typed
    `run_not_found` failure with message *"No review found for run_id
    <runId> on this PR — call get_findings without run_id to see the most
    recent review, or run_agent_on_pr to start a new run."* Never return
    an empty `findings: []` silently — always distinguish "ran, zero
    findings" (success, `findings: []`, `verdict` present) from "hasn't
    run yet" (failure, next-step message) so a calling agent can't
    mistake "no reviews" for "clean PR." `runAgentOnPr(repo, pr, agent)` →
    resolve all three → `POST /pulls/:pullId/review { agentId }`; because
    that endpoint is synchronous the completed review is usually in the
    response (main path). The **poll+timeout-fallback orchestration lives
    here**: if the POST would exceed the 120s ceiling, poll
    `GET /pulls/:id/reviews` every 2s until 120s, then return the
    timeout-fallback result (practice #4 applied to timeout, not a bare
    error). `getBlastRadius(repo, pr?, file?)` → returns the provisional
    `not_implemented` structured result with **no HTTP call** (decision
    #4) — kept here so presentation stays uniformly "call one service
    method."
  - Independently testable with a mocked HTTP port and zero MCP machinery.
- **Skills the implementer will apply:** `zod`, `typescript-expert`
  (discriminated result ADT, exhaustive handling), `security`,
  `engineering-insights`
- **Depends on:** Step 2
- **Tests to run/add:** Step 7 — the bulk of the suite lives here
  (resolution cases, each shaping/pagination path, and `runAgentOnPr`'s
  three timing branches via fake timers).

### Step 4: Presentation layer — the five thin MCP tool files

- **Type:** core
- **Module/package:** `mcp-server/` (npm)
- **Owned paths (exclusive):** new: `mcp-server/src/tools/list-agents.ts`,
  `mcp-server/src/tools/get-conventions.ts`,
  `mcp-server/src/tools/get-findings.ts`,
  `mcp-server/src/tools/run-agent-on-pr.ts`,
  `mcp-server/src/tools/get-blast-radius.ts`,
  `mcp-server/src/tools/types.ts` (shared descriptor type)
- **What changes:** Five thin presentation files. Each exports a factory
  `makeXTool(service: McpService)` returning an MCP tool descriptor
  `{ name, description, inputSchema, annotations, handler }`. The handler
  does only three things: (1) receive the already-validated flat input,
  (2) call **exactly one** `service.*` method, (3) map the typed result to
  MCP content — success → the concise structured payload, `failure` →
  `isError` content carrying the next-step message. **No `fetch`,
  resolution, or trimming here.** Concrete tool contracts (practices
  #2/#3, flat scalars, trimmed output):

  - **`list_agents`** — input `{}`; output
    `{ agents: [{ id, name, provider, model, enabled, strategy }] }`.
    Description states *when*: "Call first to discover which reviewer
    agents exist and their exact ids/names before running one."
    Annotations: `readOnlyHint: true, idempotentHint: true,
    openWorldHint: true`.
  - **`get_conventions`** — input `{ repo }`; output
    `{ scan_status, last_scan_at, conventions: [{ category, rule,
    evidence: "path:lines", confidence, accepted }], page, page_size,
    total }`, paginated. Annotations: read-only/idempotent/openWorld true.
  - **`get_findings`** — input `{ repo, pr, run_id?, page?, page_size? }`;
    output `{ run_id, verdict, score, summary, findings: [{ severity,
    category, title, file, line, rationale, suggestion? }], page,
    page_size, total }`. **Pagination from day one** (retrofitting would
    break the contract). On the `no_reviews_yet`/`run_not_found` failures
    from the service (see Step 3), surfaces as `isError` content carrying
    that next-step message verbatim — never a silent empty `findings: []`.
    Annotations: read-only/idempotent/openWorld true.
  - **`run_agent_on_pr`** — input flat `{ repo, pr, agent }` (no nested
    object, practice #2). Success output `{ status: "completed", run_id,
    verdict, score, summary, findings: [...trimmed...], findings_count }`
    (practice #3, never the raw `ReviewRunResponse`). Timeout fallback
    (from the service) `{ status: "timeout", run_id, message: "Review
    still running after 120s. Call get_findings with repo=<..> pr=<..>
    once it finishes." }`. Annotations: `readOnlyHint: false,
    destructiveHint: false, idempotentHint: false, openWorldHint: true` —
    it costs real LLM spend and creates a run, so explicitly not
    read-only/idempotent; the description says so.
  - **`get_blast_radius`** — input flat `{ repo, pr?, file? }`; output
    `{ status: "not_implemented", message: "…provisional contract; lands
    in a future DevDigest module." }` returned as a **normal** result (not
    `isError`, not fake data). Annotations: `readOnlyHint: true,
    idempotentHint: true, openWorldHint: false` (no external call).

  Note (§8): there is **no `GET /runs/:id/findings` route** — findings are
  reachable only via `GET /pulls/:id/reviews` (which carries `run_id`), so
  `get_findings` takes `repo`+`pr` and treats `run_id` as a filter. This is
  handled in the service (Step 3); the tool just passes it through.
- **Skills the implementer will apply:** `zod` (flat `inputSchema`,
  `schema-use-enums`), `typescript-expert`, `security`,
  `engineering-insights`
- **Depends on:** Step 3 (all five call the service; disjoint tool files,
  but all depend on the same service surface — see §8 on parallelism)
- **Tests to run/add:** Step 7 — thin presentation tests: one
  success-mapping + one failure→`isError`-mapping assertion per tool
  (service mocked), since the heavy logic is already covered at Step 3.

### Step 5: Composition root — wire client → service → tools, register the server

- **Type:** core
- **Module/package:** `mcp-server/` (npm)
- **Owned paths (exclusive):** new: `mcp-server/src/server.ts`,
  `mcp-server/src/index.ts`
- **What changes:** The one place that knows every layer (the
  `platform/container.ts` equivalent). `server.ts` reads `config`,
  constructs the HTTP client (Step 2) with the base URL/timeout,
  constructs `McpService` (Step 3) with that client + run policy, builds
  the MCP server from `@modelcontextprotocol/sdk`, and registers the five
  tool descriptors by calling each `makeXTool(service)` (Step 4). The
  server `instructions` field carries the shared context once (base
  URL/env; identify a repo by UUID or `owner/repo`; identify a PR by
  number or UUID; call `list_agents` before `run_agent_on_pr`;
  `run_agent_on_pr` costs real LLM spend), keeping each tool `description`
  focused on *when* (non-redundant, §4). `index.ts` is the executable
  entry (`start` script) that wires `StdioServerTransport`. Note recorded
  for the future: no tool-search/lazy-loading at 5 tools — revisit past
  ~15–20.
- **Skills the implementer will apply:** `typescript-expert`, `security`,
  `engineering-insights`
- **Depends on:** Steps 2, 3, 4 (the single integration point — this is
  why the package is mostly sequential)
- **Tests to run/add:** Step 7 — a smoke test that the server registers
  exactly five tools with the expected names + annotation flags, wired
  against a mocked HTTP client.

### Step 6: `get_blast_radius` — (folded into Steps 3+4)

Removed as a standalone step. The stub is now a service method (Step 3) +
a thin tool (Step 4), so it obeys the same "presentation calls one service
method" rule as the others rather than being a special-case tool that
returns inline. Called out here so the renumbering is explicit.

### Step 7: Hermetic test suite (+ optional gated integration)

- **Type:** core
- **Module/package:** `mcp-server/` (npm)
- **Owned paths (exclusive):** new: `mcp-server/vitest.config.ts`,
  `mcp-server/src/**/*.test.ts` (colocated per layer/file),
  `mcp-server/test/helpers/*` (a mock HTTP-client port)
- **What changes:** Vitest suite, hermetic by default (mock the HTTP port
  — no running API, no LLM), matching `TESTING.md`'s "mock the outside
  world" + one-happy-path-plus-the-edge philosophy. Coverage is layered
  like the code: **most tests target the service (Step 3)** — resolution
  cases, the "not reachable → run `./scripts/dev.sh`" and other next-step
  failures, each shaping/pagination path, and `runAgentOnPr`'s
  synchronous-completion / slow-POST-then-poll / poll-exhausted-timeout
  branches (fake timers); **infra tests (Step 2)** assert schema
  validation + typed-error mapping against a mocked `fetch`;
  **presentation tests (Step 4)** assert only the result→content/`isError`
  mapping against a mocked service. Optionally one **integration** test
  gated behind `MCP_IT=1` that drives the real stdio server against a
  locally running seeded API, self-skipping when the flag/API is absent
  (mirrors the server suite self-skipping without Docker). Note an
  `mcp-server.yml` CI workflow (path-filtered on `mcp-server/**` plus
  `server/src/vendor/shared/**`, since it type-checks against the shared
  alias) per `TESTING.md`'s per-package model — workflow authoring can be
  deferred (§ Out of scope).
- **Skills the implementer will apply:** `typescript-expert`, `security`,
  `engineering-insights`
- **Depends on:** Steps 2–5
- **Tests to run/add:** `npm test` green; `npm run typecheck` green.

### Step 8: Module docs + INSIGHTS

- **Type:** core
- **Module/package:** `mcp-server/` (npm)
- **Owned paths (exclusive):** new: `mcp-server/INSIGHTS.md`,
  `mcp-server/docs/architecture.md`, `mcp-server/specs/` (this file)
- **What changes:** Seed the module-doc trio per root `AGENTS.md`.
  `docs/architecture.md` documents the three-layer split as the
  **MCP-adapted `backend-onion-architecture`** (the §4 mapping table), so
  a future architecture review can check the code against a named,
  intended layering; plus the thin-HTTP-client design, the
  synchronous-review finding, and the provisional blast-radius contract.
  `INSIGHTS.md` records the non-obvious findings this build surfaced
  (synchronous `POST /pulls/:id/review`; no `GET /runs/:id/findings`
  route; local API auth-free via `LocalNoAuthProvider`; the layering
  decision and why the service must not import the MCP SDK).
- **Skills the implementer will apply:** `engineering-insights`,
  `typescript-expert`
- **Depends on:** Step 7
- **Tests to run/add:** none (docs).

## 6. Cross-cutting concerns

- **Layering is the load-bearing change in this revision.** The
  dependency-direction rule (`tools/*` → `service/**` → `http/client.ts`;
  service must not import the SDK) is what a `pr-self-review` /
  architecture pass should verify. Enforce it as a review check;
  optionally add an import-boundary lint rule later.
- **No contract change required.** Every shape read/returned already
  exists in `@devdigest/shared`; the service only *trims* them. A missing
  field would change `@devdigest/shared` first — nothing in scope requires
  it.
- **Single DI seam (`src/server.ts`, Step 5)** wires all three layers and
  is the only SDK-aware wiring point besides the tool descriptors'
  `annotations`/`inputSchema`. The service constructor's injected HTTP
  port is the swap point for tests.
- **Rate-limit awareness:** `POST /pulls/:id/review` has a 10/min cap
  (`server/README.md:59-61`); the service maps a 429 to a retry-oriented
  `rate_limited` failure, surfaced by presentation as `isError`.

## 7. Out of scope / explicitly deferred

- Any change to `server/` routes (e.g. a cleaner `GET /runs/:id/findings`)
  — server change, deferred.
- The real blast-radius feature — stub only.
- Remote/HTTP MCP transport, auth, multi-workspace selection — stdio +
  default local workspace for v1.
- Tool-search / lazy tool loading — unnecessary at 5 tools; future concern
  past ~15–20.
- Authoring the `mcp-server.yml` CI workflow — may be a follow-up; the
  plan fixes its path filter either way.
- `e2e/` browser suite — untouched; MCP is not a browser flow.

## 8. Open questions / risks

- **Synchronous review vs. blocking poll (resolved in-plan, confirm
  intent).** `POST /pulls/:id/review` returns completed `reviews`
  synchronously (`reviews/routes.ts:34-54`); the service's 2s/120s poll is
  a timeout *fallback*, not the primary loop. Confirm the fallback shape
  and that holding the HTTP connection up to 120s suits the intended MCP
  clients.
- **No by-run-id findings route.** Findings are only reachable via
  `GET /pulls/:id/reviews` (`run_id` is a field, not a route param), so
  `get_findings` requires `repo`+`pr` and filters by `run_id`. Confirm
  acceptable, or accept a follow-up server route as the cleaner long-term
  contract.
- **`@modelcontextprotocol/sdk` exact API surface** (tool-registration
  call shape, annotation field names, `instructions` field, stdio wiring)
  varies across SDK versions — **hand to the `researcher` subagent** to
  pin the current version's API before Step 5, since this plan has no
  `WebFetch`. Confined to the presentation descriptors + composition root
  by the layering, so it does not leak into the service.
- **`openWorldHint` semantics** for tools calling our *own* local API is a
  judgement call; the plan sets `true` (they reach a network service).
  Confirm against SDK guidance during research.
- **`run_agent_on_pr` failure detection.** How a *failed* run surfaces in
  `GET /pulls/:id/reviews` vs. a completed one needs a quick confirmation
  against `ReviewService.runReview` during implementation, to map it to a
  clean `failure` result rather than a misleading "completed."
- **Parallelization assessment (honest, revised).** The layering makes
  the package a strict dependency chain: Step 1 → 2 → 3 → 4 → 5 → 7 → 8.
  Step 3 (service) concentrates the logic and gates Step 4; Step 5 is the
  single integration point. There is now **no genuinely parallel step** —
  the earlier plan's parallel `get_blast_radius` step was folded into
  Steps 3+4 precisely to honor the layering. Recommend **one implementer
  running Steps 1–8 in order**. Within Step 4 the five tool files are
  disjoint and could be split across instances, but each is thin enough
  that the coordination overhead outweighs the gain — not worth an
  artificial split.

## 9. Suggested review path (not performed here)

- Before PR: run the `pr-self-review` skill (per root `AGENTS.md`).
- **Architecture check specific to this revision:** verify the dependency
  direction `tools/* → service/** → http/client.ts` holds, that
  `src/service/**` imports nothing from `@modelcontextprotocol/sdk`, and
  that no `tools/*` file calls `fetch` or contains resolution/trimming
  logic — this is the MCP-adapted `backend-onion-architecture` rule and
  the whole reason for the revision.
- Security angle (low-risk): base URL from env (safe), no secrets handled,
  local API auth-free by design — confirm no user-controlled value reaches
  `fetch` beyond the configured base URL + validated ids.

## 10. Suggested spec path

This file — `mcp-server/specs/mcp-server-plan.md` — persisted per the
per-module `specs/` convention in root `AGENTS.md`.

---

Key files (all absolute), for the implementer to ground against:

- `/Users/o.ivashkov/projects/private/dev-digest/server/src/modules/reviews/routes.ts` (synchronous review — shapes `run_agent_on_pr`)
- `/Users/o.ivashkov/projects/private/dev-digest/server/src/modules/pulls/routes.ts` (`/repos/:id/pulls`, `/pulls/:id`, `/pulls/:id/reviews`)
- `/Users/o.ivashkov/projects/private/dev-digest/server/src/modules/{agents,repos,conventions}/routes.ts`
- `/Users/o.ivashkov/projects/private/dev-digest/server/src/modules/_shared/context.ts` (no-auth confirmation)
- `/Users/o.ivashkov/projects/private/dev-digest/server/src/vendor/shared/contracts/{findings,review-api,platform,knowledge}.ts` (all output shapes)
- `/Users/o.ivashkov/projects/private/dev-digest/reviewer-core/tsconfig.json` (shared-alias pattern to copy)
- `/Users/o.ivashkov/projects/private/dev-digest/.claude/skills/backend-onion-architecture` (the layering §4 adapts)

The only change from the prior version is internal layering: the former
`resolve/identifiers.ts` and `tools/shared/output.ts` are now inside
`src/service/**`, `tools/*.ts` became thin presentation wrappers calling
one service method each, `src/http/client.ts` is a proper infrastructure
adapter reachable only from the service, and `src/server.ts` is the
composition root. Every reference-image practice, user decision, tool
contract, annotation, the synchronous-review finding, the blast-radius
stub, and the testing approach are unchanged.
