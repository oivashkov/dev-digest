# Insights — cross-package

Decisions that span more than one package, and things we tried that did not
work. Module-local lessons go in `<module>/INSIGHTS.md` instead.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. Every entry must be actionable cold: claim first, `path:line` or a
runnable command last. If it would be obvious to anyone reading the code, leave
it out.

Roughly 5 entries per section. When an entry becomes stable reference material,
move it into `docs/` and delete it here.

---

## Decisions

### 2026-08-05 — PR list COST column is a total spend, not the latest run's price

**What:** `GET /repos/:id/pulls`'s `PrMeta.cost_usd` now sums `agentRuns.costUsd`
across every `status='done'` run for that PR, instead of reporting only the
most recent completed run's cost. `server/src/modules/pulls/routes.ts`
(`totalCostByPr`), doc comment updated in both vendored copies of
`contracts/platform.ts`.
**Why:** explicit user request — the column should answer "what have I spent
reviewing this PR", not "what would reviewing it cost right now".
**Rejected:** the prior "latest run wins" behavior, which was itself a
deliberate, tested decision — `server/test/pulls-cost.it.test.ts` originally
asserted the OPPOSITE (`// 0.0043 would mean the column summed both runs` was
the failure case). That test's assertions were inverted to match. **If you
find yourself "fixing" the sum back to latest-only, check the date on this
entry first** — it is not a regression, it is the current intended behavior.

### 2026-07-31 — Standalone packages instead of a workspace

**What:** four packages, each with its own `package.json` and lockfile; sharing
happens through tsconfig path aliases, not published modules. Each suite is
gated by its own CI workflow with a path filter.
**Why:** _rationale not recorded anywhere in the repo — fill this in._ Do not
"fix" this into a workspace before that gap is closed; it is load-bearing for the
per-package CI path filters.

### 2026-07-31 — Zod contracts as the single source of truth

**What:** `@devdigest/shared` schemas drive request validation, response
serialization, and client-side types.
**Why:** one definition, no drift between server and client.
**Rejected:** hand-rolled `Schema.parse(req.body)` inside handlers — it validated
input but left responses unchecked, so contract drift surfaced in the browser.

## What Works

_None yet._

## What Doesn't Work

_None yet._

## Codebase Patterns

- **2026-08-04** — `server/src/vendor/shared` and `client/src/vendor/shared`
  are two independent copies of `@devdigest/shared`, not a symlink or a build
  step — editing one does NOT update the other, and nothing fails loudly when
  they drift (the client just keeps stale types). A contract change must be
  hand-copied into both. The client's copy is also allowed to lag on anything
  it doesn't import (e.g. it never needed `GitHubClient`/`GitLabClient` from
  `adapters.ts`, only `Repo`/`RepoProvider` from `contracts/platform.ts`) — diff
  the specific file before copying wholesale, don't sync files the client
  doesn't use. `server/src/vendor/shared/contracts/platform.ts`,
  `client/src/vendor/shared/contracts/platform.ts`
- **2026-08-01** — Per-run LLM cost is already computed end-to-end; the only
  thing ever missing is persistence. Every provider returns `costUsd` on its
  result, and for OpenRouter it is the REAL billed figure — the client asks for
  it with `usage: { include: true }` and reads `usage.cost`, falling back to the
  injected `PriceBook` estimator. `reviewPullRequest` then sums it across
  map-reduce chunks onto `ReviewOutcome.costUsd`. Commit `d45ab0d` removed the
  cost *feature* by dropping that one field at the destructure in
  `run-executor.ts` and deleting the `agent_runs.cost_usd` column, leaving the
  computation intact. So surfacing cost anywhere costs **zero extra model
  calls** — wire up the existing field, never add a pricing lookup or a second
  request. `reviewer-core/src/review/run.ts:216`. **Re-added 2026-08-01 in
  commit `84e2c1e`** (merged via PR #101, branch `mp-l01`): `agent_runs.cost_usd`
  column, `cost_usd` back on `RunStats`/`RunSummary`/`PrMeta`, and a client
  `RunCostBadge` wired into the PR list and the Agent-runs Timeline. **Before
  building a "show me the cost" request as new work, `git log --oneline --all |
  grep -i cost` first** — in this repo a sibling lab branch may have already
  merged it; the actual remaining gap on 2026-08-05 was just one more render
  site (`ReviewRunAccordion`) that this commit hadn't covered, see
  `client/INSIGHTS.md`.

## Tool & Library Notes

- **2026-08-06** — `server`'s hermetic vitest suite (`pnpm exec vitest run
  --exclude '**/*.it.test.ts'`) crashes the whole run intermittently on Node
  v24.4.0 with `RangeError: Maximum call stack size exceeded` inside
  `tinypool@1.1.1`'s worker-pool teardown (`ProcessWorker.terminate` /
  `WorkerInfo.destroy`), not inside any test. It is a pool-teardown race, not
  a code regression — reproduces identically on an unmodified checkout
  (confirmed via `git stash`) and is non-deterministic (passed 2 of 3 runs
  back-to-back with no code change). If the run crashes without an assertion
  failure in the output, re-run before suspecting your change; to sidestep
  it for one file, add `--pool=forks --poolOptions.forks.singleFork`.

## Recurring Errors & Fixes

- **2026-08-04** — `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild,
  sharp, cpu-features, ssh2, …` on a machine's first `pnpm install` in
  `server/` or `client/` (pnpm ≥10's build-script approval gate). The app
  half-boots (API up, but native deps like `ssh2`/`sharp` silently missing
  their compiled binding) until this is resolved. Fix: `cd server && pnpm
  approve-builds --all` and the same in `client/`, then re-run
  `./scripts/dev.sh`. Also needs Node on PATH first — this sandbox requires
  `nvm use stable` (or `corepack enable`) before any `pnpm`/`npm` command
  works at all.

## Open Questions

_None yet._
