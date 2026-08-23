# Insights — mcp-server

Decisions and dead ends for the `mcp-server/` package. Read before touching
the SDK wiring, the layering, or `run_agent_on_pr`'s orchestration — a lot
of what looks arbitrary here was forced by an SDK quirk or a corrected
assumption about the server's actual behavior.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it
out.

Formats — `Decisions` takes prose; every other section takes a dated bullet:

```markdown
### YYYY-MM-DD — <short title>

**What:** the decision, in one sentence.
**Why:** the constraint that forced it.
**Rejected:** what we tried or considered, and how it failed.
```

```markdown
- **YYYY-MM-DD** — <the claim, specific enough to act on cold>.
  `src/path/to/file.ts:42`
```

---

## Decisions

### 2026-08-23 — `list_agents` drops `agent.provider` from its output

**What:** `AgentSummary` (`src/service/results.ts`) and `trimAgent`
(`src/service/shape.ts`) no longer carry `provider`
(`openai`/`anthropic`/`openrouter`) — `list_agents` now returns only `id`,
`name`, `model`, `enabled`, `strategy`.
**Why:** a PR reviewer flagged it as an internal implementation detail an
MCP tool response shouldn't surface: a calling agent picks/identifies an
agent by `id`/`name` (per `SERVER_INSTRUCTIONS` in `src/server.ts`), never
by which LLM vendor backs it — every extra field is tokens spent in the
calling model's context for no decision it needs to make.
**Rejected:** keeping `provider` per `specs/mcp-server-plan.md` §5 Step 4's
original tool contract (`{ id, name, provider, model, enabled, strategy }`)
— that plan is now stale on this one field; left unedited as historical
record rather than revised.

### 2026-08-19 — `run_agent_on_pr` always polls; the plan's "synchronous review" assumption was wrong

**What:** `McpService.runAgentOnPr` (`src/service/index.ts`) never treats
`POST /pulls/:id/review`'s own HTTP response as the source of the completed
review. It always falls through to polling `GET /pulls/:id/runs` (failure
detection) and `GET /pulls/:id/reviews` (completion) until `hardTimeoutMs`.
**Why:** `POST /pulls/:id/review` is fire-and-forget server-side —
`server/src/modules/reviews/service.ts`'s `runReview` calls `void
this.executor.executeRuns(...)` and returns `{ pr_id, runs, reviews: [] }`
immediately; the review only appears later via `GET /pulls/:id/reviews`.
This package's own plan (`specs/mcp-server-plan.md` §4, §5 Step 3) asserted
the opposite — "`POST /pulls/:id/review` is synchronous… reviews already
populated" — sourced from a docstring in `server/src/modules/reviews
/routes.ts` that was stale relative to the actual `run-executor.ts`
implementation.
**Rejected:** trusting the plan's synchronous assumption and treating the
poll loop as a rare fallback (would have made the "main path" the one that
never actually fires) — kept a defensive check for it (`response.reviews`
immediate match short-circuits the poll if a future server version *does*
go synchronous) but it is not the expected path today.

## What Works

_None yet._

## What Doesn't Work

- **2026-08-19** — A `PATCH`/`POST` failure or cancellation of a review run
  never produces a row in `GET /pulls/:id/reviews` — the server only records
  that outcome in `agent_runs.status`/`error`, reachable via `GET
  /pulls/:id/runs` (`RunSummary`). This was a real gap: `DevDigestApiPort`
  initially had no method to read it, so a failed run would poll silently
  until `hardTimeoutMs` and report a misleading `{status:'timeout'}` instead
  of the actual failure. Fixed by adding `listRuns()` to `http/client.ts` +
  `http/types.ts` and a `run_failed` typed failure to `service/results.ts` +
  `service/index.ts` — each poll iteration checks the run ledger BEFORE the
  reviews check, so `status: 'failed' | 'cancelled'` returns immediately
  instead of waiting out the budget. `RunSummary.ran_at` is set at run
  *creation*, not completion, and `listRuns` sorts DESC by it — this is what
  makes `findOwnRun()`'s "most recent run for this agent at/after
  `startedAt`" correlation possible when the initiating POST's own
  `run_id` was never observed (its per-request timeout fired first).
  `src/service/index.ts` (`runAgentOnPr`, `findOwnRun`).

## Codebase Patterns

- **2026-08-19** — `src/tools/types.ts` deliberately defines its own
  `McpToolAnnotations`/`McpToolHandlerResult`/`McpToolDescriptor` types that
  only *mirror* `@modelcontextprotocol/sdk`'s shapes, instead of importing
  the SDK's own types — this keeps every `src/tools/*.ts` file free of any
  `@modelcontextprotocol/sdk` import; only `src/server.ts`'s single
  `registerTool()` helper reconciles the two shapes (see the Tool & Library
  Notes entry below for why that reconciliation needs a narrow `as any`).
  Follow this pattern for a sixth tool rather than importing SDK types
  directly into `src/tools/*.ts`.
- **2026-08-19** — `McpService.getConventions(repo, page?)` does not accept
  a `pageSize` parameter — the response's `page_size` is always
  `shape.ts`'s `DEFAULT_PAGE_SIZE` (20), even though the `get_conventions`
  tool's `inputSchema` (`src/tools/get-conventions.ts`) accepts a
  `page_size` field from the caller and silently drops it before calling
  the service. This is a known, intentional gap (documented inline in the
  tool file) — kept for input-shape symmetry with `get_findings` (which
  *does* thread `pageSize`), not a bug that slipped through review. A
  follow-up should either wire `pageSize` through
  `McpService.getConventions` or drop the field from the tool's
  `inputSchema` until it's honored — don't assume the current handler is
  incomplete by accident. `src/tools/get-conventions.ts:30-34`,
  `src/service/index.ts` (`getConventions`).

## Tool & Library Notes

- **2026-08-23** — Claude Code's `.mcp.json` stdio server entry DOES accept a
  top-level `"timeout"` field (milliseconds) — confirmed empirically, not
  from docs: `claude mcp add-json <name> '{...,"timeout":5000}' -s local`
  then `claude mcp get <name>` prints `Timeout: 5000ms`. Root `.mcp.json`'s
  `devdigest` entry sets `"timeout": 125000` — just above
  `MCP_HARD_TIMEOUT_MS`'s default 120000 — so `run_agent_on_pr`'s own poll
  budget can't be cut short by Claude Code's own tool-call timeout. A
  `"cwd"` field, by contrast, is silently ignored: a stdio server always
  spawns with the launching process's cwd (verified by spawning `pwd` from
  a configured server and reading its output — it printed the project root,
  not the configured `"cwd"`), regardless of what `"cwd"` says. `.mcp.json`.
- **2026-08-23** — Because `.mcp.json`'s `"cwd"` is a no-op (see above),
  invoking `mcp-server` directly via `node --import <tsx-loader> src/index.ts`
  (bypassing `npm --prefix mcp-server start`, which used to shift cwd to
  `mcp-server/` as a side effect of `--prefix`) breaks tsx's
  `tsconfig.json` `paths` alias resolution for `@devdigest/shared` — tsx
  walks up from `process.cwd()` to find the nearest `tsconfig.json`, not
  from the entry file's own directory, so without a cwd shift it finds none
  and throws `ERR_MODULE_NOT_FOUND: Cannot find package '@devdigest/shared'`.
  Fix: set `TSX_TSCONFIG_PATH` explicitly to the absolute path of
  `mcp-server/tsconfig.json` in the server's `env` — tsx then skips the
  cwd-relative search entirely. `.mcp.json`.
- **2026-08-21** — `tsconfig.json`'s `include: ["src/**/*.ts"]` does NOT
  exempt `test/helpers/*.ts` from `npm run typecheck` — `tsc` treats
  `include` only as the *root* file set; any file transitively imported by a
  root file (e.g. `test/helpers/mock-api-client.ts` from
  `src/service/index.test.ts`) is still type-checked. Concretely: adding a
  method to `DevDigestApiPort` (`src/http/types.ts`) forces
  `test/helpers/mock-api-client.ts`'s `MockApiClient` mapped type to require
  a matching default entry in `createMockApiClient`'s base object, or
  `tsc --noEmit -p tsconfig.json` fails there even though nothing in
  `src/**` was left broken. `npm test` (vitest/esbuild) would NOT have
  caught this — esbuild strips types without checking them — so a green
  `npm test` with a red `npm run typecheck` is possible and each command
  must be run separately, not inferred from the other.
- **2026-08-19** — `zod` MUST stay pinned to `^3.24.1` in `package.json` —
  do not bump to npm's `latest` (`4.x`). `@devdigest/shared`
  (`server/src/vendor/shared/**`) contracts are Zod v3 schemas; a v4
  install would break every schema this package imports via the tsconfig
  alias. `tsconfig.json`'s `paths` entry (`"zod": ["./node_modules/zod"]`,
  `"zod/*": ["./node_modules/zod/*"]`) is a **self-pin alias** — it forces
  every `zod` import (including the one inside the vendored
  `@devdigest/shared` source, which physically resolves relative to
  `server/`) to resolve through *this* package's own `node_modules/zod`
  install, guaranteeing a single zod instance package-wide. `package.json`
  (`dependencies.zod`), `tsconfig.json:24-25`.
- **2026-08-19** — `server.ts`'s `registerTool()` helper contains one
  narrow, documented `as any` pair (the config object and the handler, at
  the final hand-off to `server.registerTool(...)`) — this is an
  intentional, bounded exception to the project's TypeScript strictness,
  not an oversight. Cause: `tsconfig.json`'s `zod` `paths` self-pin alias
  (needed per the entry above) makes TypeScript resolve this package's own
  `z.ZodOptional<...>` tool-schema types through a different
  module-resolution path than `@modelcontextprotocol/sdk`'s own internal
  `zod/v3` import — so TS treats two structurally-identical `ZodType`
  classes as different types and fails assignability, even though both
  resolve to the exact same installed `zod` package/version at runtime.
  Runtime correctness was confirmed via a live MCP stdio handshake (manual
  test), not just typecheck passing. `Args` (the function's own generic
  type parameter) still gives the `args` handler parameter its full,
  checked shape — only the final SDK hand-off is unchecked. **Possible
  future fix**: narrow the `zod` `paths` alias so it applies only to files
  under the vendored `@devdigest/shared` path, if a tsconfig `paths` scoped
  by consumer (not just by specifier) turns out to be expressible — not
  attempted here since it risks breaking the guarantee the alias exists
  for. `src/server.ts:16-41`.
- **2026-08-19** — A generic Zod parse helper typed as
  `parse<T>(schema: z.ZodType<T>, ...)` breaks type inference for any
  schema whose Input and Output types differ (e.g. a field with
  `.default()` — optional on input, required on output). `z.ZodType<T>`
  alone defaults `Input = Output = T`, so TS can't unify a single `T`
  against a schema that actually has two, and silently narrows the return
  type to the (still-optional) Input shape — which then fails assignability
  against a fully-resolved return type like `Agent[]`. Fix: widen to
  `z.ZodType<T, z.ZodTypeDef, unknown>`, decoupling Input from `T` so
  inference resolves to the intended Output type. `src/http/client.ts`
  (`parse` — private method, `DevDigestApiClient`).
- **2026-08-19** — Node's global `fetch` (undici-backed) wraps a connection
  failure like `ECONNREFUSED` one level deep: the `catch` block sees
  `TypeError: fetch failed` with **no** `.code` on the top-level error — the
  actual system error (which carries `.code`) is one `.cause` link down.
  Reading only the top-level error's `.code` silently produces `undefined`
  and loses the useful diagnostic (e.g. "start it with `./scripts/dev.sh`"
  messaging relies on recognizing this). `describeCause()` in
  `src/http/client.ts` walks `.cause` before falling back to the top-level
  error. `src/http/client.ts:201-208`.
- **2026-08-19** — `@modelcontextprotocol/sdk@1.30.0`: a bare `import ...
  from '@modelcontextprotocol/sdk'` does NOT resolve — the package's
  `exports` map in `package.json` points at a root entry file that isn't
  actually present in the published npm tarball. Only subpath imports work,
  e.g. `@modelcontextprotocol/sdk/server/mcp.js` and
  `@modelcontextprotocol/sdk/server/stdio.js` (both used in `src/server.ts`
  / `src/index.ts`). Separately: `server.tool(...)` is deprecated in this
  version — use `server.registerTool(name, config, handler)` instead; and
  `instructions` is a constructor-level field on `ServerOptions` (the
  second argument to `new McpServer(info, options)`), not a separate method
  call. `src/server.ts:2, 84-87`.
- **2026-08-19** — Upstream awareness (not acted on): a separately
  published `@modelcontextprotocol/server`/`@modelcontextprotocol/core`
  v2.0.0 line exists and is being actively maintained, published roughly 3
  weeks before this package was built — possibly a future redesign of the
  SDK surface used here. This package deliberately stays on the
  `@modelcontextprotocol/sdk` v1.x line per the plan; flagging only so a
  future upgrade session knows to check whether the v1.x line is still the
  right one to be on, not to prompt an unplanned migration now.

## Recurring Errors & Fixes

_None yet._

## Open Questions

_None yet._
