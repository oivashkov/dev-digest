# Architecture — `mcp-server/`

`mcp-server/` exposes five MCP tools (`list_agents`, `run_agent_on_pr`,
`get_findings`, `get_conventions`, `get_blast_radius`) over stdio. It is a
**thin HTTP client** to the local DevDigest Fastify API
(`http://localhost:3001`) — it imports no `server/src/**` internals, only
`@devdigest/shared` contracts via a tsconfig path alias.

Read this before touching layering, adding a sixth tool, or reviewing a PR
against this package. See `specs/mcp-server-plan.md` for the plan this was
built from; this file is the durable reference the plan pointed to.

## The three-layer split (MCP-adapted `backend-onion-architecture`)

`server/`'s Onion layering (`backend-onion-architecture` skill) is scoped to
a Fastify+Drizzle app. This package has neither a DB nor Fastify, so the
layers map to a different set of files, but the same rule holds:
**presentation → application → infrastructure, dependencies point inward,
no layer-skipping.**

| Onion layer (`server/`) | `mcp-server/` equivalent | Rule |
|---|---|---|
| Presentation — `modules/<name>/routes.ts` | `src/tools/*.ts` | Declares the MCP `inputSchema`/`annotations`/`description`; the handler calls **exactly one** `service.*` method and maps the returned typed result to MCP content blocks / `isError`. No `fetch`, no resolution logic, no trimming/pagination inline. |
| Application / domain — `service.ts` | `src/service/**` (`index.ts`'s `McpService` facade, `resolve.ts`, `shape.ts`, `results.ts`) | Repo/PR/agent resolution, the run+poll+timeout-fallback orchestration for `run_agent_on_pr`, and all trim/pagination shaping. **MUST NOT import `@modelcontextprotocol/sdk`** — the MCP-boundary equivalent of "`service.ts` MUST NOT import `FastifyInstance`/`FastifyRequest`". Plain arguments in, a typed `ServiceResult<T>` (success/failure ADT) out — testable with zero MCP machinery. |
| Infrastructure — ports & adapters — `src/adapters/*` | `src/http/client.ts` (+ `errors.ts`, `types.ts`) | The **only** place a `fetch` to the DevDigest API happens — the single port to the external system, implementing the `DevDigestApiPort` interface declared in `http/types.ts` (mirrors `@devdigest/shared/adapters.ts`'s port-interface pattern). Called only from `src/service/**`, never from `src/tools/*`. Swappable for `test/helpers/mock-api-client.ts` in tests. |
| Composition root — `platform/container.ts` | `src/server.ts` | The one place that wires the HTTP client into the service and the service into the registered tool descriptors. The only module that knows every layer at once. `src/index.ts` is the executable entry (stdio transport wiring) on top of it. |
| Shared kernel — `@devdigest/shared` contracts | same, via tsconfig `paths` alias | Domain contracts (`Agent`, `Finding`, `ReviewRecord`, `RunSummary`, …) reused read-only; never redeclared locally. |

## Dependency direction (MUST)

```
src/tools/*.ts  →  src/service/**  →  src/http/client.ts
```

- Never the reverse. `src/http/*` and `src/service/**` MUST NOT import from
  `src/tools/*` or from `@modelcontextprotocol/sdk`.
- The only file that imports `@modelcontextprotocol/sdk`'s `McpServer` type
  (besides `index.ts`'s transport) is `src/server.ts` — the composition
  root. `src/tools/types.ts` deliberately defines its own
  `McpToolDescriptor`/`McpToolAnnotations`/`McpToolHandlerResult` types that
  merely *mirror* the SDK's shapes, rather than importing them, so that
  `src/tools/*.ts` files stay decoupled from the SDK's own type surface —
  only `server.ts`'s `registerTool()` helper needs to reconcile the two.
- `src/service/index.ts`'s `McpService` is constructed with a
  `DevDigestApiPort` (an interface, not the concrete `DevDigestApiClient`)
  plus a plain `McpServiceOptions` policy object — the DI seam that tests
  swap for a mock.

## Thin HTTP client design

`src/http/client.ts`'s `DevDigestApiClient` is the only `fetch` call site in
the package:

- One typed method per DevDigest API endpoint the service needs (`GET
  /agents`, `GET /repos`, `GET /repos/:id/pulls`, `POST /pulls/:id/review`,
  `GET /pulls/:id/reviews`, `GET /pulls/:id/runs`, `GET
  /repos/:id/conventions`).
- Every response is validated with the matching `@devdigest/shared` Zod
  schema via `.safeParse()` before it is trusted — this is the boundary
  where server JSON becomes typed data. A schema mismatch becomes a typed
  `bad_response` error, never a silent `as`-cast.
- Failures are a typed, discriminated `ApiClientError` union
  (`unreachable`, `timeout`, `rate_limited`, `not_found`, `bad_response`,
  `http_error` — see `src/http/errors.ts`), thrown wrapped in
  `ApiClientException`. The client knows nothing about MCP `isError`;
  turning an error kind into a next-step-oriented message for a calling
  agent is `src/service/results.ts`'s `failureFromApiError()`.
- Per-request timeout is independent of `runAgentOnPr`'s much larger
  poll/timeout-fallback budget (`MCP_REQUEST_TIMEOUT_MS` default 30s vs.
  `MCP_HARD_TIMEOUT_MS` default 120s) — a request-level timeout during the
  initial `POST /pulls/:id/review` is a signal to *fall through to polling*
  with the run id still unknown, not a hard failure (see
  `McpService.runAgentOnPr`'s doc comment).

## `run_agent_on_pr`: the run+poll+timeout-fallback orchestration

**`POST /pulls/:id/review` is fire-and-forget, not synchronous** — see
`INSIGHTS.md` for the full finding and why the plan's original assumption
was wrong. `McpService.runAgentOnPr` therefore always:

1. `POST /pulls/:id/review { agentId }` — extracts a `run_id` from
   `response.runs` if present (defensive: if a future server version *does*
   return the completed review synchronously, an immediate match in
   `response.reviews` short-circuits the poll loop, but this is not the
   expected path today).
2. Polls, every `pollIntervalMs` (default 2s) up to `hardTimeoutMs` (default
   120s, measured from the start of the call including the initial POST):
   - `GET /pulls/:id/runs` first, to detect a server-side `failed`/
     `cancelled` outcome immediately (`run_failed` typed failure) instead of
     waiting out the full budget and misreporting it as a timeout.
   - `GET /pulls/:id/reviews` to check for the matching completed review.
3. If the budget runs out, returns a `{ status: 'timeout', run_id?,
   message }` result — never a bare error — telling the caller to check
   back with `get_findings`.

If the run id itself was never observed (the initial POST's own
`requestTimeoutMs` fired before a response arrived), the poll loop
correlates by `agentId` + "run started at/after this call's `startedAt`"
against `GET /pulls/:id/runs` (`findOwnRun()` in `src/service/index.ts`) —
an accepted, narrow race at `ran_at`'s second-level precision.

## `get_blast_radius` contract

`McpService.getBlastRadius(repo, pr?, file?)` resolves `repo` via
`resolveRepo`, then (unlike the tool's `inputSchema`, which keeps `pr`
optional for input-shape symmetry with the other four tools) requires `pr` —
there is no repo-wide blast radius, only a per-PR one. If `pr` is omitted,
it returns a typed `invalid_input` failure with a next-step message ("pass
pr=<number> to look up its blast radius") **before any HTTP call at all**,
mirroring `resolve.ts`'s own convention of rejecting malformed input ahead
of the network. Otherwise it resolves the PR via `resolvePr` and calls `GET
/pulls/:id/blast` (`DevDigestApiPort.getBlastRadius`), which returns
`@devdigest/shared`'s `PrBlastRadius` — symbols declared in the PR's changed
files, their resolved callers (`file:line`, ranked), and the endpoints/crons
reachable within a 2-level reverse import walk. Deterministic — no LLM call
on either side (`server/src/modules/reviews/routes.ts`'s `/pulls/:id/blast`
doc comment).

`file`, when given, narrows the result to symbols declared in that one file
— a **pure client-side filter** (`filterBlastRadiusByFile` in
`src/service/index.ts`): the server route has no `?file=` query param, so
this package recomputes `impacted_endpoints`/`impacted_crons`/`counts` from
the filtered symbol subset rather than ever claiming counts that include
data outside `file`. `status`/`reason` pass through unchanged — `file`
narrows scope, not index completeness.

See `docs/plans/blast-radius.md` (Step 5) for the full design history; this
replaced an earlier provisional stub that returned
`{ status: 'not_implemented', message }` with no HTTP call at all, pending
the real `server/` route landing.

## Result ADT and error-leads-forward messaging

Every `McpService` method returns `ServiceResult<T>` (`src/service/results.ts`)
— `{ ok: true, data }` or `{ ok: false, failure: { kind, message } }` —
instead of throwing. `message` is always written as the next thing a
calling agent should do (e.g. "start it with `./scripts/dev.sh`", "call
list_agents to see available agents"), never a bare diagnostic. Presentation
(`src/tools/types.ts`'s `toolSuccess`/`toolFailure`) maps this 1:1 onto MCP
content: success → one `text` block of pretty-JSON data, failure → one
`text` block with `failure.message` verbatim and `isError: true`.

## Testing shape

Coverage is layered like the code (`vitest.config.ts`, colocated
`*.test.ts` files, `test/helpers/mock-api-client.ts`):

- **`src/http/client.test.ts`** — schema validation + typed-error mapping
  against a mocked global `fetch`.
- **`src/service/*.test.ts`** — the bulk of the suite: resolution cases,
  each shaping/pagination path, and `runAgentOnPr`'s timing branches (via
  fake timers), against a mocked `DevDigestApiPort`.
- **`src/tools/*.test.ts`** — thin: one success-mapping + one
  failure-to-`isError`-mapping assertion per tool, against a mocked
  `McpService`.
- **`src/server.test.ts`** — a smoke test that `createServer()` registers
  exactly five tools with the expected names/annotations, wired against a
  mocked HTTP client.

No test requires a running DevDigest API or an LLM key — the whole suite is
hermetic by construction, since the only I/O boundary (`DevDigestApiPort`)
is always the mock in tests.
