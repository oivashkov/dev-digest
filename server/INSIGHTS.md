# Insights — server

Server-side decisions and dead ends. Read before redesigning anything here; a
lot of what looks arbitrary was a deliberate trade-off.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it out.

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

Roughly 5 entries per section. Promote stable entries into `docs/` and delete
them here. Insights about `src/vendor/shared/` go in the **root** `INSIGHTS.md` —
a contract change reaches every package.

---

## Decisions

### 2026-07-31 — Schema-first validation at the route boundary

**What:** every route declares Zod `params`/`body`/response schemas from
`@devdigest/shared` via `fastify-type-provider-zod`; invalid input is rejected
with `422` before the handler runs.
**Why:** one definition has to drive both request validation and response
serialization, or the two drift.
**Rejected:** hand-rolled `Schema.parse(req.body)` inside each handler — it
validated input only, left responses unchecked, and duplicated the schema
reference in every route.

## What Works

_None yet._

## What Doesn't Work

_None yet._

## Codebase Patterns

_None yet._

## Tool & Library Notes

- **2026-08-05** — `@gitbeaker/rest`'s `agent` constructor option is typed as
  Node's `http.Agent` (from `'http'`) but at runtime is forwarded verbatim as
  fetch's `dispatcher` (`@gitbeaker/rest/dist/index.mjs`: `if (agent)
  fetchArgs.push({ dispatcher: agent })`) to the GLOBAL `fetch`/`Request`
  (`defaultRequestHandler` calls bare `fetch(...)`, never an imported one) —
  an undici `Agent` is what actually belongs there; gitbeaker just didn't
  want undici as a type dep. Bridge the TS gap with `as unknown as
  import('http').Agent`.
  **The installed `undici` npm package's major version MUST match the major
  Node bundles internally** (`process.versions.undici`, e.g. `7.11.0` on
  Node v24.4.0) — installing latest (`undici@8.x`) throws at request time:
  `TypeError: fetch failed` / `InvalidArgumentError: invalid onRequestStart
  method` (undici 8 redesigned the Handler/interceptor protocol; Node's
  built-in fetch, backed by its own bundled undici 7, can't dispatch through
  an 8.x `Agent`). Fix: `pnpm add undici@^7` (matching Node's major, not the
  npm `latest` tag) — verify with `node -e
  "console.log(process.versions.undici)"` if the error resurfaces after a
  Node upgrade. To skip TLS verification for one client (self-signed/expired
  cert on a self-hosted instance): `new Agent({ connect: {
  rejectUnauthorized: false } })` — undici's `Agent`/`Pool`/`Client` all
  accept a `connect` option extending `node:tls`'s `ConnectionOptions`.
  `node:undici` is NOT a Node builtin in this environment
  (`ERR_UNKNOWN_BUILTIN_MODULE` on v24.4.0, both `require` and `import`), so
  `undici` has to be an explicit `package.json` dependency regardless.
  `src/adapters/gitlab/gitbeaker.ts:60`
- **2026-08-05** — `simple-git` supports per-instance `-c` config overrides
  via `simpleGit(baseDir, { config: ['http.sslVerify=false'] })`, scoped to
  that one `SimpleGit` instance (never a global git config write). Documented
  only in the package README's "Per-command Configuration" section — the
  bundled `.d.ts` files don't surface `SimpleGitOptions.config` in an
  easily-greppable way. `src/adapters/git/simple-git.ts` (`gitOpts()`).
- **2026-08-04** — `@gitbeaker/rest`'s `Gitlab<C extends boolean = false>`
  camelize generic does NOT default to `false` when constructed as `new
  Gitlab({ token, host })` — `C` is a phantom type param TypeScript can't
  infer from the options shape, so every response field widens to a `T |
  Camelize<T>` union (e.g. `mr.source_branch` typed as `string |
  Camelize<unknown>`), breaking property access across the whole adapter.
  Fix: pin it explicitly — `new Gitlab<false>({...})` and store the field as
  `InstanceType<typeof Gitlab<false>>`. `src/adapters/gitlab/gitbeaker.ts:60`

## Recurring Errors & Fixes

- **2026-08-05** — Adding an optional field to a widely-shared interface
  (e.g. `RepoRef.insecureTls?: boolean`) is invisible to `tsc` at every call
  site that omits it — typecheck stays 100% clean even though the field
  silently never reaches those call sites. When adding an optional field
  meant to reach every consumer of a shared type, grep for every
  construction site by hand instead of trusting a clean typecheck — e.g.
  `grep -rn "container\.git\."` found 5 `RepoRef` literals in
  `repo-intel/service.ts` (×3), `repo-intel/pipeline/incremental.ts`, and
  `repo-intel/pipeline/full.ts` that the compiler had no reason to flag.
  Also check narrowed/trimmed row types fed by a `SELECT` with an explicit
  column list (e.g. `RepoIntelRepository.getRepoBasics()` only selected
  `owner/name/defaultBranch/clonePath` — the new column had to be added to
  that `.select({...})` too, not just the `repos` table).

## Open Questions

_None yet._
