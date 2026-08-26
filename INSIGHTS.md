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

### 2026-08-26 — `.github/workflows/evals.yml` wires `ci-detect.mjs` per-PR; model split per tier, only skill-evals blocks merge

**What:** New `.github/workflows/evals.yml`: a `detect` job diffs the PR
against its base and runs the already-existing `evals/scripts/ci-detect.mjs`
to map changed files onto `{ skills[], agents[], run_workflow }`, then three
downstream jobs consume those outputs — `skill-evals` (matrix per changed
skill, content-tier, direct to OpenRouter, no proxy) and `agent-evals`
(matrix per changed agent) + `workflow-evals` (triggers on `CLAUDE.md`/any
agent/the eval engine changing) which both bring up the bundled LiteLLM
proxy (`evals/proxy/`) since they're tool-tier. Model is **not** hardcoded
and **not** shared across tiers — each job reads its own pair of repo
Variables with its own default, so switching one tier's model is a Settings
change, never a workflow edit:
`EVAL_MODEL_SKILLS`/`EVAL_JUDGE_MODEL_SKILLS` (default
`deepseek/deepseek-v4-flash`), `EVAL_MODEL_AGENTS`/`EVAL_JUDGE_MODEL_AGENTS`
(same default), `EVAL_MODEL_WORKFLOW`/`EVAL_JUDGE_MODEL_WORKFLOW` (default
`google/gemini-2.5-flash`). Only `skill-evals` is a required check;
`agent-evals`/`workflow-evals` run `continue-on-error: true`.
**Why:** `ci-detect.mjs`, the LiteLLM proxy, and a GitHub Actions template
already existed in `evals/` (`evals/README.md:189-245`, from the same commit
that added the eval package) but were never wired into an actual
`.github/workflows/*.yml` — this file is that wiring, not a new engine.
The per-tier model split follows `evals/README.md`'s own verified-model
table (`:160-181`): `workflow-evals` is the tier that actually asserts the
model **decides** to dispatch a subagent via the `Agent` tool — the one
capability DeepSeek was measured lacking (does the work inline instead) —
so it alone defaults to `google/gemini-2.5-flash`. `agent-evals` only needs
correct `Read`/`Grep`/`Bash` tool use (no dispatch decision), and
`skill-evals` needs no tool calls at all, so both stay on the cheaper
DeepSeek default. The blocking split (only `skill-evals` required) exists
for the same reason: making the dispatch-sensitive tiers required would
block merges on a model quirk, not a real regression.
**Rejected:** one shared `EVAL_MODEL`/`EVAL_JUDGE_MODEL` pair for all three
jobs (the first version of this workflow) — collapses under the same
verified-model table, since the cheapest model that passes `skill-evals`
is not the one that passes `workflow-evals`'s dispatch assertion.
**Open question:** the user's requested slug, `deepseek/deepseek-v4-flash`,
could not be independently confirmed against OpenRouter's live catalog —
`WebFetch` against `openrouter.ai/api/v1/models` returned inconsistent
results across repeated calls in the same session (different "first 5
models" each time, including names that don't look real), a signal of
hallucinated fetch content rather than a genuine read. It's now the pinned
default throughout `evals/README.md`, `evals/proxy/litellm.config.yaml`,
and this workflow's `EVAL_MODEL_SKILLS`/`EVAL_MODEL_AGENTS` per explicit
user choice — but note the "does the work inline instead of dispatching"
finding in `evals/README.md`'s verified-model table was measured against
the older `deepseek/deepseek-chat` slug, not re-run against `v4-flash`; the
tier split above assumes it still applies rather than having reconfirmed
it. Verify the slug on `openrouter.ai/models` and consider rerunning
`agent-evals`/`workflow-evals` once against `v4-flash` to confirm the
dispatch behavior transferred — it's a one-line repo Variable either way.

### 2026-08-25 — Renamed the `specreator` subagent to `spec-creator`

**What:** `.claude/agents/specreator.md` → `.claude/agents/spec-creator.md`
(`git mv`, frontmatter `name:` updated to match), plus every current-state
reference across `.claude/agents/README.md`, `.claude/agents/diagrams.md`,
`.claude/agents/implementation-planner.md`, `.claude/skills/run-plan/`,
`.claude/skills/workflow-retro/`, every `<module>/specs/README.md` +
`e2e/docs/README.md`, and `specs/03-pr-why-risk-brief{,-plan}.md`'s two
passing tool-name mentions. Hyphenation only — tools, model, scope, and
behavior are unchanged.
**Why:** user-requested naming-convention fix, 2026-08-25 — every other
multi-word agent in this repo is kebab-case
(`implementation-planner`, `architecture-reviewer`, `plan-verifier`,
`doc-writer`, `test-writer`); `specreator` was the one holdover without a
hyphen.
**Note:** the entry directly below (2026-08-23) is left as-written — it
records the agent's introduction under its original name and is a historical
decision record, not a live reference; do not "fix" its wording to match the
new name.

### 2026-08-23 — Added `specreator`, a dedicated spec-authoring subagent; reverses the same day's "human/`doc-writer`-driven only" decision below

**What:** New `.claude/agents/specreator.md` (`Read`, `Write`, `Edit`, `Grep`,
`Glob`, `Bash`, `Skill`; model opus; write scope prompt-restricted to `specs/`
root+modules plus the `e2e/docs/` exception). Takes a feature description
plus whatever design sources exist (screenshots pasted into the
conversation, text, a Figma/other link it cannot fetch, existing code) and
writes a `specs/` file in a fixed EARS-based template (`Spec ID`/`Status`/
`Supersedes` header; Problem & user, Goals/Non-goals, User stories,
Acceptance criteria (EARS) with bilingual triggers `WHEN (КОЛИ)` +
`shall (shall)`, Edge cases, Non-functional requirements, Inputs and
provenance, Untrusted inputs, Open questions). Every design gap it finds
(missing state, uncovered edge case, unclear cross-module contract, UX
rough edge) goes back to the user as a question or an accept/decline-able
proposal — never resolved silently. All five `specs/README.md` templates
(root, `server`, `client`, `reviewer-core`, plus new `mcp-server/specs/README.md`)
were rewritten to this one shared template, replacing the previous
per-module ad hoc shapes and the `draft|agreed|in progress|shipped` status
vocabulary with `draft|approved|implemented`. `e2e/` keeps its written specs
in `e2e/docs/` (its `specs/` holds only executable `*.flow.json`), now noted
in both `e2e/specs/README.md`'s sibling `e2e/docs/README.md` and
`specreator.md` itself.
**Why:** the user asked, session of 2026-08-23, for a dedicated
Spec-Driven-Development authoring agent, explicitly including design-source
analysis (screenshots/Figma/text/existing code) for gap-finding — a role no
existing agent filled since `implementation-planner` reviews requirements
but never authors them (see the entry directly below). Confirmed
user-facing decisions during design: reuse the existing root `specs/`
(not a new `docs/specs/`) since its README already stated the intended
cross-package rule; fully replace the per-module templates rather than
layering a technical appendix; grant `Write`+`Edit` (not `Write`-only)
inside `specs/` so a draft can be revised in place before approval; keep the
no-`WebFetch` convention shared by every other agent (Figma links are noted,
not opened).
**Rejected:** giving `specreator` `WebFetch` as an exception for Figma
links — every other content-authoring agent in this repo already routes
external unknowns to "ask the user" or `researcher` rather than fetching
directly, and a bare Figma URL usually needs auth this agent won't have
anyway. Also rejected: a `docs/specs/` location distinct from the existing
root `specs/` — would have produced two competing cross-package spec
locations for no reason, when the existing one's README already described
the intended rule almost verbatim.
**Correction to the entry below:** this reverses "keeps `specs/` authorship
a deliberate, human- (or `doc-writer`-) driven act, never a byproduct of
asking for a plan" — that constraint was about `implementation-planner`
specifically not blurring into spec authorship as a plan-writing
side-effect, which still holds (`implementation-planner` still never
authors a spec). It was not meant to rule out a purpose-built spec-authoring
agent entirely, and the user has now explicitly asked for one.

### 2026-08-23 — `planner` renamed to `implementation-planner`; spec-authoring surface removed, requirements review + execution-mode question added

**What:** `.claude/agents/planner.md` → `.claude/agents/implementation-planner.md`
(new `name:`, updated `description:`), with every cross-reference to it
(`README.md`, `diagrams.md`, `implementer.md`, `architecture-reviewer.md`)
renamed to match. Three behavioral changes to the agent itself:
1. Dropped the output format's "Suggested spec path" section entirely — the
   agent no longer names or implies a `specs/` persistence path for its own
   plan. `implementer.md`'s precondition step (persisting a conversational
   plan before acting on it) now always falls back to
   `<module>/specs/<slug>-plan.md` on its own, since there is nothing left
   for the planner to suggest.
2. Added a "Requirements review" step (new §1): the agent now reviews
   whatever requirements already exist (request text + `<module>/specs/`)
   for gaps/ambiguity and surfaces them as clarifying questions, plus an
   explicit "Recommendations" output section for a better approach when one
   is grounded in what it read — but the boundary is explicit and absolute:
   it never authors, edits, or amends a specification/requirements document
   itself, under any phrasing.
3. Added a mandatory execution-mode question (§0): always ask the user
   single-agent (one sequential `implementer` pass) vs. multi-agent
   (disjoint Owned paths for parallel `implementer` instances) before
   writing steps, rather than inferring it from phrasing. Plan construction
   (§6) now only enforces strict Owned-path disjointness when multi-agent
   was confirmed; single-agent mode only needs a stated "Depends on" where
   sequencing actually matters.
**Why:** the old `planner.md` blurred "plan the implementation" with
"produce the artifact that becomes the spec" by suggesting a `specs/` path
for its own output — conflating a disposable planning document with the
curated, intentional specs `AGENTS.md`'s context-search order treats as
source of truth. Splitting them keeps `specs/` authorship a deliberate,
human- (or `doc-writer`-) driven act, never a byproduct of asking for a
plan. The execution-mode question was previously answered implicitly by how
steps happened to come out; asking up front avoids a plan that's silently
unsafe to parallelize (or needlessly fragmented for a single sequential
run).
**Rejected:** keeping the old name and only editing behavior — the user
asked for the rename specifically, and it also disambiguates the agent from
a "spec-writing" reading of "planner" going forward. Also rejected: giving
`implementation-planner` a light `Write` scoped to a `plans/` directory to
persist its own output — same harness limitation already recorded above
(no path-scoped `Write` grant), and it would reopen exactly the blurred
boundary this change removes.

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

- **2026-08-23** — When a human resolves a `specreator` spec's "Open
  questions" one by one (as happened for `specs/01-project-context.md`'s 13
  gaps), do the full ripple for each question — its Open-questions entry
  **and** every downstream Acceptance-criteria/Goals/Edge-case touchpoint it
  affects — in one Edit pass, not two. Splitting them (mark "RESOLVED" first,
  discover later that an AC also needed the same decision) roughly doubled
  the Edit-call count for questions Q7, Q9, Q10, and Q13 in that session — a
  `/workflow-retro` run over it counted ~28 Edit calls against one spec file
  after the agent's single handoff. Read the whole spec once per question
  before editing to find every place a decision needs to land, not just its
  own Open-questions paragraph.
  **Partially confirmed 2026-08-23, same day, on `specs/02-onboarding-tour.md`'s
  13 questions:** batching every round's Open-questions resolutions into one
  Edit call (all 4 in one pass, then all 9 in another, instead of one Edit
  per question) cut the count to ~10 Edit calls total for that spec — but the
  *downstream* ripple (Acceptance-criteria/Contract-changes/Inputs-table
  touchpoints) was still mostly done as separate follow-up edits, not folded
  into the same pass. The batching helps; it does not by itself replace
  "read the whole spec once per question to find every place it lands."

- **2026-08-23** — `Agent` with `isolation: "worktree"` is an effective
  mitigation when a **different, concurrent** Claude Code session is heavily
  active in the same checkout. Two plain (non-isolated) `specreator` launches
  for `specs/02-onboarding-tour.md` failed back-to-back while a peer session
  was `busy` implementing SPEC-01 in the same working tree — one stalled 600s
  with no progress, one was killed mid-run — a third attempt in an isolated
  worktree completed cleanly. Trade-off: the worktree is a clean checkout of
  the **last commit**, so it cannot see the peer session's own uncommitted
  work (a feature, not a bug, when that work shouldn't be read as grounding
  anyway) nor any just-committed-but-not-yet-fetched sibling spec — one run
  had to carry "spec 01 wasn't readable from this worktree" as an Open
  question until the file was copied back and compared by hand. The output
  file(s) must be manually copied out of
  `.claude/worktrees/agent-<id>/<path>` into the primary checkout, and the
  worktree + its branch removed afterward (`git worktree remove --force`,
  `git branch -D`) — this does not happen automatically when the run produced
  changes.

## What Doesn't Work

_None yet._

## Codebase Patterns

- **2026-08-24** — Amending an **already-approved, already-implemented**
  spec (`specs/03-pr-why-risk-brief.md`, adding the 8k-token prompt budget)
  is append-only: new acceptance criteria get the next free numbers
  (25-35) and are placed in the group where they belong *logically* — here
  between the "LLM call / output" (9-10) and "Grounding" (11-13) groups —
  so item numbering is intentionally non-monotonic in document order, with
  a one-line parenthetical on the new group's heading saying why. Existing
  items are never renumbered or reworded (their numbers are referenced from
  `specs/03-pr-why-risk-brief-plan.md`, from other ACs, and from code
  comments), `Status:`/`Supersedes:` are left alone (an amendment is not a
  supersede), and the rationale lands as a new dated numbered item in the
  spec's own "Open questions" section, matching how that file already
  records product-owner decisions. Check `git diff --stat` shows
  insertions-only before reporting such an amendment done.

- **2026-08-24** — Two pieces of PR Why + Risk Brief scaffolding already
  existed, unused, before `specs/03-pr-why-risk-brief.md` was written:
  `pr_brief` table (`{ prId, json }`, zero writers/readers,
  `server/src/db/schema/reviews.ts:93-97`) and a registered `risk_brief`
  `FeatureModelId` defaulting to `openai/gpt-4.1`
  (`server/src/vendor/shared/contracts/platform.ts:64-70`). A **third**
  piece, `brief.ts`'s `PrBrief { intent, blast, risks, history }`, is a
  false match — same "zero writers" status but a different shape (no
  `what`/`why`/`risk_level`/`review_focus`). SPEC-03 resolves this the same
  way `blast.ts` already resolved the identical situation for
  `PrBlastRadius` (see its own doc-comment, `blast.ts:1-19`): reuse the
  table and the feature-model id as-is, but add a **new** file
  `contracts/risk-brief.ts` rather than reshaping the old `PrBrief` —
  `PrBrief` stays untouched and still unpopulated. Grep for `pr_brief`,
  `risk_brief`, and `PrBrief` before assuming any of the three is free real
  estate for a new feature.

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
  **Sharper, silent-in-both-directions case found 2026-08-23 building Project
  Context (`specs/01-project-context-plan.md` Step 1):** the "caught by
  typecheck" guarantee above depends on the target column being
  `.$type<Contract>()`-annotated in Drizzle. `agent_versions.config_json` is a
  bare `jsonb('config_json').notNull()` with **no** `.$type<AgentVersionConfig>()`
  (`server/src/db/schema/agents.ts:45`), so adding `context_docs` to
  `AgentVersionConfig` did **not** fail `pnpm typecheck` when the hand-built
  literal in `AgentsRepository.snapshotVersion`
  (`server/src/modules/agents/repository.ts`) omitted it — the compiler had no
  type to check the literal against. Worse, `.default([])` on the new field then
  makes `AgentVersionConfig.parse(row.configJson)` in `toAgentVersionDto`
  (`server/src/modules/agents/helpers.ts`) succeed forever on old snapshots that
  never contain it, silently returning the default instead of erroring. A green
  `pnpm typecheck` is not evidence a jsonb-backed hand-built literal was updated —
  grep the literal itself, and check whether the backing column is
  `.$type<>()`-annotated before trusting the compiler to catch a missed field.
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
  **Second, larger instance confirmed 2026-08-23 while speccing Project
  Context (`specs/01-project-context.md`)** — the same pattern spans FIVE
  layers there, all present, none connected: the `SpecFile`/`IndexStatus` Zod
  contracts (`vendor/shared/contracts/platform.ts:271-284`), client hooks
  `useContextFiles`/`useReindexContext` already calling
  `GET /repos/:repoId/context` + `POST /repos/:repoId/context/reindex`
  (`client/src/lib/hooks/core.ts:123-138`), a fully-written i18n namespace
  `client/messages/en/context.json` (naming `.devdigest/specs/` as the root),
  the `code_chunks` table with an `embedding vector(1536)` column and a
  `source: 'code'|'docs'|'spec'` enum (`server/src/db/schema/context.ts:31-47`),
  and the engine's `specs` prompt slot rendering `## Project context` with
  `wrapUntrusted` (`reviewer-core/src/prompt.ts:104,125`) plus
  `RunTrace.specs_read` and the trace drawer UI that renders both
  (`TraceBody.tsx:39-51,90-92`). **Zero** server routes implement
  `/repos/:id/context`, **zero** writers touch `code_chunks`, and
  `run-executor.ts:319` hardcodes `specs_read: []`. Two traps for whoever
  builds it: the pre-existing contract is **repo**-scoped while agents/skills
  are **workspace**-scoped, so "which repo does an attached path resolve
  against" is a real design decision the scaffolding silently pre-answers;
  and `client/messages/en/context.json` encodes a `.devdigest/specs/` layout
  that conflicts with a repo-wide `specs/`+`docs/`+`INSIGHTS.md` reading.
  Grep `messages/en/<ns>.json` and `lib/hooks/*` for a feature's namespace
  before scoping it — the copy and the endpoints may already dictate a shape.
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

- **2026-08-23** — The `<total_tokens>N tokens left</total_tokens>` system
  reminder attached to tool results is **not** a monotonically-decreasing
  usage counter — it can jump back up between turns (context summarization/
  compaction frees budget), so diffing "first seen" against "most recent"
  across a whole session does not yield a trustworthy orchestrator-thread
  token cost, only a same-turn or same-stretch approximation at best.
  Discovered writing the `workflow-retro` skill (`.claude/skills/
  workflow-retro/SKILL.md` §2), whose own orchestrator-cost method relies on
  this diff — treat any number derived from it as directional within one
  uninterrupted stretch of turns, never as a session-wide total.
  **Compounding gap, confirmed 2026-08-23 same day:** a `failed`/`killed`
  `Agent` task-notification carries no `<usage>` block at all (only a
  `<result>` fragment of whatever it managed to output) — two stalled/killed
  `specreator` retries for `specs/02-onboarding-tour.md` did real,
  tool-consuming work before dying, but `/workflow-retro`'s per-agent
  accounting has no figure to attribute to either attempt. Retried-agent sunk
  cost is systematically invisible to this method, not just imprecise —
  say so explicitly rather than omitting the failed attempts from the count.
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

- **2026-08-20** — `.mcp.json`'s `devdigest` stdio server failed to (re)connect
  (`/mcp` reports `-32000`) even though the API and Postgres were both healthy.
  Cause: `command` pointed at nvm's `npm` by absolute path, but the MCP client
  spawns it with a minimal environment whose `PATH` excludes nvm's node bin
  dir — `npm-cli.js`'s own `#!/usr/bin/env node` shebang then can't resolve
  `node`, failing with `env: node: No such file or directory` before it ever
  reaches `mcp-server/`. An absolute `command` path is not enough; the child
  process's own shebang resolution still needs `node` on `PATH`. Fix: add an
  explicit `env.PATH` to that server's `.mcp.json` entry, e.g. `"PATH":
  "/Users/o.ivashkov/.nvm/versions/node/v24.4.0/bin:/usr/local/bin:/usr/bin:/bin"`.
  Apply the same fix to any future stdio MCP server config in this repo that
  shells out to `node`/`npm`. `.mcp.json`.
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
