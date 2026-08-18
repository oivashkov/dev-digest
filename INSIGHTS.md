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

### 2026-08-17 — Four new pipeline subagents (`test-writer`, `architecture-reviewer`, `plan-verifier`, `doc-writer`) split into read-only-auditor vs. prompt-scoped-write tiers

**What:** Per `docs/plans/new-subagents.md`, added
`.claude/agents/{test-writer,architecture-reviewer,plan-verifier,doc-writer}.md`,
built by 4 parallel `implementer` instances (one per file, disjoint Owned
paths). They split into two tool-privilege tiers that map directly onto
role: the two auditors (`architecture-reviewer`, `plan-verifier`) get exactly
`Read, Grep, Glob, Bash` — no `Write`/`Edit`/`Skill`/`Agent` — matching
`planner.md`'s existing read-only precedent; the two producers
(`test-writer`, `doc-writer`) get `Write`/`Edit`/`Skill` but their write
scope (test files only; `docs/`+`specs/` only) is enforced **entirely by
prompt text**, repeated in the tools-and-scope section *and* the closing
Scope-boundaries section — there is no harness mechanism to grant `Write`
scoped to a path glob (same limit already recorded for `planner`, above).
`plan-verifier` additionally needed an explicit "note it, never let it
change your verdict" carve-out to keep it from drifting into
`architecture-reviewer`'s or `code-review`'s territory when it notices an
unrelated issue while tracing a plan item.
**Why:** keeps each write-capable agent's blast radius provably narrow (a
reviewer can grep the prompt for the restriction) despite tool grants being
coarse-grained by name only; keeps auditors honest by construction (no tool
to drift into editing with) rather than by instruction alone. Evidence cited
inside `architecture-reviewer.md`'s "what NOT to report" calibration
(e.g. the known `container.github()` deviation at
`server/src/modules/settings/routes.ts:96`) was re-verified live against the
repo at authoring time rather than trusted from skill prose, since skills
describe the pattern class but not necessarily current line numbers.
**Rejected:** giving any of the four `Agent` (spawning) — matches the
existing `researcher`/`planner`/`implementer` boundary, all orchestration
stays the invoking session's call.

### 2026-08-17 — `implementer` preloads skills via frontmatter `skills:` and runs one plan step at a time, in parallel-safe "Owned paths"

**What:** `.claude/agents/implementer.md` uses subagent frontmatter's
`skills:` field (confirmed real via `code.claude.com/docs/en/sub-agents`:
injects full skill content at startup, not just the description) to preload
12 fixed project skills, instead of looking each file up in
`.claude/skills/pr-self-review/references/skill-scope-map.md` and invoking
`Skill` per file. `.claude/agents/planner.md` now splits a plan into steps
each with disjoint **Owned paths** and a **Type** (backend/ui/core/e2e), and
`implementer` executes exactly one step per invocation — multiple instances
can run different steps of the same plan in parallel as long as Owned paths
don't overlap. `implementer` has no `Write`/`Edit` even for its own output;
its precondition step persists the plan to `<module>/specs/<slug>-plan.md`
**idempotently** (skip if already written, to avoid two parallel instances
racing on the same file) rather than overwriting.
**Why:** preloading is the Anthropic-documented mechanism for this, cheaper
and more reliable than a per-file glob lookup + on-demand `Skill` call, and
since all 12 skills stay available regardless of a step's type, a stale
"skills the implementer will apply" line in the plan is low-stakes — it's a
judgment hint (§4 of both files' shared Type→skill table), not a hard gate.
The Owned-paths/parallel model matches a user-supplied draft that turned out
to check out: its per-module conventions (DI via `container.ts` +
`adapters/mocks.ts`, `container.vcsFor()`, TanStack Query + hooks-only data
access, `next-intl`, `groundFindings()` mandatory, injected `LLMProvider`)
were all confirmed against `server/AGENTS.md`/`client/AGENTS.md`/
`reviewer-core/AGENTS.md` and folded into `implementer.md` §4. `planner`
stays tool-level read-only (matching `researcher.md`'s no-Write/Edit
boundary); the same draft's addition of an `Agent` tool to `implementer` was
rejected — implementer executes, it does not spawn other agents or
instances, that stays the invoking session's call.
**Rejected:** giving `planner` `Write` scoped only to `specs/` — Claude
Code's `tools` frontmatter grants/denies by tool name only, not by path, so
that would give unrestricted `Write` in practice; persisting from
`implementer`'s side (idempotently) keeps the boundary real. Also rejected:
`implementer` self-persisting the plan unconditionally, which would race
when multiple instances run the same plan's steps in parallel — made
idempotent instead. One `<module>/insights/` directory path appeared in the
user's draft; the repo's actual convention is a single `<module>/INSIGHTS.md`
file, kept as-is.

### 2026-08-06 — AGENTS.md as source of truth, CLAUDE.md a thin `@AGENTS.md` import

**What:** each of the 5 curated agent-notes files (root + one per package) is
now `<pkg>/AGENTS.md` holding the actual content (stack, commands,
conventions, gotchas, read-when); `<pkg>/CLAUDE.md` shrinks to a first-line
`@AGENTS.md` import plus a short Claude-Code-only addendum (the
`engineering-insights` skill invocation).
**Why:** Claude Code has no native `AGENTS.md` support as of mid-2026 (only
the documented `@path` import), while Codex, Cursor, Copilot, Gemini CLI and
Windsurf read `AGENTS.md` natively. Splitting keeps one editable source of
truth instead of two copies.
**Rejected:** a plain `ln -s AGENTS.md CLAUDE.md` symlink — simpler and
driftproof, but the ~95%-generic file has one Claude-only line (which skill to
invoke for `INSIGHTS.md`), and a real symlink leaves no room for that without
polluting the file every other agent reads.

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

- **2026-08-18** — Extending a Zod contract with a `.default([])` field
  breaks every existing *hand-written object literal* typed as that schema
  at compile time, even though `.default()` makes the field optional on
  `.parse()` input. `z.infer<typeof Schema>` (the OUTPUT type) still marks a
  defaulted field as required, so `Intent.extend({ plan_refs:
  z.array(z.string()).default([]), confidence: z.number()... })`
  (`server/src/vendor/shared/contracts/brief.ts`) immediately broke
  `pull.repo.ts`'s `getIntent()`, which builds an `Intent` object literal
  by hand instead of parsing through the schema — caught by `pnpm
  typecheck`, not a runtime surprise. This is expected/anticipated when a
  step in a multi-step plan adds fields a *later, dependent* step's file is
  supposed to fill in (Step 2 here); grep every hand-built literal of a
  contract before assuming "additive" means zero breakage.
- **2026-08-12** — A feature can be scaffolded consistently across the DB
  schema, the Zod contract, AND a pure-engine prompt slot with **zero lines
  connecting them at runtime** — no module, no route, no UI, no caller ever
  populating the value. Before this session, the Skills feature had
  `skills`/`skill_versions`/`agent_skills` tables, `Skill`/`AgentSkillLink`
  contracts, fully-working agent-side linking routes
  (`GET/POST /agents/:id/skills`), AND `reviewer-core`'s `assemblePrompt`
  already rendering a `## Skills / rules` section from a `skills?: string[]`
  slot it had accepted from the start — but `server/src/modules/reviews
  /run-executor.ts`'s call to `reviewPullRequest({...})` never passed
  `skills`, so the section had never rendered in a real run. Grepping for the
  DB table or the contract type is not evidence a feature works; grep the
  actual call site that would need to thread the data through (here, one
  missing spread expression) before estimating how much work remains.
  `server/src/modules/reviews/run-executor.ts`,
  `reviewer-core/src/prompt.ts:85` (`assemblePrompt`).
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

- **2026-08-06** — Reading files before `git checkout <branch>` (or a
  `git reset --hard` onto a moved remote branch) and writing their (mentally
  cached) content afterward can silently carry over content that only existed
  on the old ref. The stale-write guard ("File has been modified since read")
  only fires if the target file's bytes actually changed between the Read and
  the Write, so it caught `server/CLAUDE.md` here but stayed silent for files
  whose content happened to match. After switching branches or rebasing mid-
  task, `git diff --stat <old-ref> <new-ref> -- <paths>` the specific files
  before trusting an earlier Read, rather than relying on the guard alone —
  also applies to `git push` rejections: `git fetch` + diff the remote before
  reapplying local doc edits, don't assume the base you built commits on is
  still current.
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
