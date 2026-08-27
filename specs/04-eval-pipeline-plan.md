# Development Plan: SPEC-04 Eval Pipeline

Plan for `specs/04-eval-pipeline.md` (SPEC-04-eval-pipeline, Status: draft, 79 EARS ACs).

## 1. Summary

Turn accept/dismiss decisions on findings into a real, per-agent eval suite: frozen cases in `eval_cases`, an asynchronous runner that executes an agent against its whole case set under a `batch_id`, and recall / precision / citation_accuracy computed by **pure code with zero LLM calls in scoring**. Four UI surfaces (one-click "Turn into eval case" on the PR page, an Evals tab with case editor + compare modal in the Agent editor, and a workspace-wide Eval Dashboard) plus a `pnpm verify:l06` gate. Built on scaffolding that already exists but is entirely unwired: two tables, nine Zod contracts, and a fully-written `messages/en/eval.json`.

## 2. Requirements reviewed

- **Supplied:** `specs/04-eval-pipeline.md` (SPEC-04, draft, 79 EARS ACs) — treated as the single source of truth over the task description. `server/specs/` and `client/specs/` contain only `README.md` stubs (no module-level spec for this feature).
- **Ambiguities found and resolved this round (all five confirmed by the user):**
  1. **Promote has no HTTP route in the spec.** ACs 54-59 define `restoreVersion()` but no endpoint; `agents/routes.ts` has none. → `POST /agents/:id/versions/:version/restore` → `200 Agent`, `404` cross-workspace/unknown version, in `agents/routes.ts`.
  2. **"Per-agent drill-down" location unstated** (ACs 49-52). → Agent editor's Evals tab; Compare modal lives there; case editor stays a **modal** (spec text wins over `page.crumbNewCase`/`crumbEvalCase`, which go unused).
  3. **`verify:l06` has no home** — no root `package.json` exists. → new root `package.json` (private, scripts-only, no deps) + `scripts/verify-l06.sh`; gate 3 verified hermetically with `MockLLMProvider`.
  4. **i18n gap is larger than the spec's list** — the spec budgets 4 gaps; reading `eval.json` key-by-key surfaces 4 more (Run-on-save toggle AC 76, finding-skeleton helper AC 75, out-of-hunk warning AC 78, Run-all-agents confirmation ACs 72-73). → all 8 authored in the shared client step.
  5. **AC 8's premise is stale.** It positions the new control "between `Dismiss` and the disabled `Learn` affordance", but `FindingCard.tsx`'s action row has only Accept and Dismiss, and the non-goals forbid adding Learn. → button goes **immediately after Dismiss**.

## 3. Context reviewed

- `specs/04-eval-pipeline.md` — the spec; its "Resolved" log (18 items) pre-answers most design questions, including that `eval_cases`/`eval_runs` are consumed as-is with exactly three additive changes.
- `server/specs/README.md`, `server/docs/README.md`, `client/specs/README.md`, `client/docs/README.md` — stubs, no eval content.
- `server/INSIGHTS.md` — four entries bind this plan: (a) 2026-08-23, `enqueue()` only awaits the DB insert, so a `GET` fired straight after reliably sees `queued`/`running` — **do not add a delay to a test**; (b) 2026-08-18, `@fastify/rate-limit` is not registered under `NODE_ENV=test`, so a `429` assertion needs its own `buildApp()` with `NODE_ENV: 'production'`; (c) 2026-08-19, a unit test asserting *filtered* behavior against a pure function is a false test when filtering happens a layer up — exactly the citation_accuracy trap; (d) 2026-08-26, `getVersion()` + `update()` restores only 7 of `AgentVersionConfig`'s 9 fields.
- `client/INSIGHTS.md` — (a) 2026-08-23, edit `src/vendor/ui/nav.ts` directly; the composition seam was investigated and rejected; (b) 2026-08-17, `src/lib/api.ts` stays generic — no per-endpoint wrappers; (c) 2026-08-10, any file importing `@devdigest/ui` must be `"use client"` or the whole app 500s; (d) 2026-08-23, derive `VALID_TABS` from `TABS` (already done); (e) 2026-08-17, `@testing-library/user-event` is **not** a dependency — use `fireEvent`; (f) 2026-08-12, toggles auto-save.
- `reviewer-core/INSIGHTS.md` — 2026-08-26: `ReviewOutcome.review.findings` is post-gate, so citation_accuracy must be `kept / (kept + dropped.length)` read off the outcome object, and the `0/0` case is the caller's to define (AC 45).
- Root `INSIGHTS.md` — 2026-08-04 the two `vendor/shared` copies are independent and drift silently; 2026-08-01 `costUsd` is already computed end-to-end (never add a pricing lookup).
- `server/AGENTS.md` / `backend-onion-architecture` — new module starts with all three layers; routes never touch `container.db`; adapters only via the container.
- `client/AGENTS.md` / `frontend-architecture` — hooks-only data access; `_components/` colocation; `src/vendor/**` off-limits except the settled `nav.ts` exception.
- Existing patterns to reuse (cited, not re-derived):
  - `server/src/modules/onboarding/service.ts:83-87` + `routes.ts:32-44` — enqueue → `202` + job id; `registerGenerationJobHandler()` called once from the routes plugin. The exact shape for the eval batch.
  - `server/src/modules/onboarding/repository.ts` `getJobStatus` — reading `jobs` from a feature repository is already the convention (ACs 21/24).
  - `server/src/platform/sse.ts:52,63,76` — `RunBus.publish/subscribe/complete` is keyed by an arbitrary string, and `reviews/routes.ts:61` `GET /runs/:id/events` does **not** check the DB, so a `batch_id` key streams over the existing route with **no change to `reviews/`** (AC 23).
  - `server/src/modules/reviews/diff-loader.ts:3,43` — `parseUnifiedDiff` from `src/adapters/git/diff-parser.js` is the parser for a stored patch string.
  - `reviewer-core/src/grounding.ts:24` `buildLineIndex`, exported from the package index — powers AC 78's out-of-hunk warning without touching `reviewer-core`.
  - `server/src/adapters/mocks.ts:59-61` — `MockLLMProvider.calls[]` records every call: this is what makes gate 4 ("scoring makes zero LLM calls") assertable rather than assumed.
  - `client/src/components/app-shell/helpers.ts:38` — `activeKeyFor` **already** maps `/eval` → `"eval"`; no change needed there.
  - `client/src/app/agents/[id]/_components/AgentEditor/constants.ts:11-21` — `TABS` + derived `VALID_TABS`.

## 4. Modules affected

| Module | Package manager | Why touched |
|---|---|---|
| `server/src/vendor/shared` (`@devdigest/shared`) | pnpm (inside `server/`) | New `EvalExpectation` schema + length caps — contract change, lands first |
| `client/src/vendor/shared` | pnpm (inside `client/`) | Hand-copied contract (independent copy, per root `INSIGHTS.md` 2026-08-04) |
| `server/` | pnpm | New `modules/evals/`, two additive `eval_runs` columns + a unique constraint + migration, `agents` restoreVersion, seed |
| `client/` | pnpm | New hooks, i18n copy, FindingCard action, Evals tab + modals, `/eval` page, `nav.ts` entry |
| `reviewer-core/` | npm | **Read-only.** Confirmed: `groundFindings`, `buildLineIndex`, `reviewPullRequest`, `ReviewOutcome.{grounding,dropped,costUsd}` all already exported from `src/index.ts`. No change needed. |
| repo root | — | New scripts-only `package.json` + `scripts/verify-l06.sh` |

## 5. Architectural constraints

- **Contracts first.** `EvalExpectation` lands in `server/src/vendor/shared/contracts/eval-ci.ts`, then is hand-copied to the client. Both barrels are `export *`, so no barrel edit is needed. Nothing fails loudly if the two drift — the copy is part of the same step, not a follow-up.
- **Onion layering, three files minimum.** `evals/routes.ts` (status codes only) → `evals/service.ts` + `evals/runner.ts` (business rules) → `evals/repository.ts` (the only place `drizzle-orm` runs for `eval_cases`/`eval_runs`). `routes.ts` must never touch `container.db`; `service.ts` must never import `FastifyInstance`; the LLM provider is resolved as `await container.llm(agent.provider)` in the service/runner, never in the repository.
- **`POST /findings/:id/eval-case` is owned by `evals/`, not `reviews/`.** `reviews/` is not modified at all. The finding is read through an evals-side repository method; the route's doc-comment must name the sibling so a grep of `reviews/routes.ts` for "every `/findings/` route" has something to find (spec, "Module ownership").
- **The eval runner calls `reviewPullRequest` directly** — not `ReviewRunExecutor`. Three reasons, all load-bearing: it inherits `wrapUntrusted`/`INJECTION_GUARD` on the diff and PR body (spec, "Untrusted inputs"); it exposes `grounding`/`dropped` for citation_accuracy, which `Review.findings` cannot give (`reviewer-core/INSIGHTS.md`); and it skips the repo-intel/intent enrichment AC 27 forbids. It must **not** write `reviews`/`findings` rows.
- **Scoring is pure and exported** — `evals/helpers.ts`, no DB, no container. Per `server/INSIGHTS.md` 2026-08-19, the citation_accuracy input (`kept`, `dropped.length`) is passed *in* by the runner; a unit test asserting gate behavior against the scorer would be a false test.
- **Every read and write scopes on `workspace_id` explicitly.** `EvalCase` (the DTO) has no workspace field and `eval_runs` reaches a workspace only transitively via `case_id`, so run reads join `eval_cases`. Cross-workspace ⇒ `404`, never `403` (AC 6, matching `findings.ts:18-20`).
- **Client: hooks-only.** New hooks in `src/lib/hooks/evals.ts` call the generic `api.get/post/put/del`; `api.ts` gains nothing. Server state stays in TanStack Query. Every string resolves through `next-intl`. Every file importing `@devdigest/ui` is `"use client"`.
- **`nav.ts` is edited directly** — the settled convention (`client/INSIGHTS.md` 2026-08-23), not a `src/vendor/**` violation to re-litigate.
- **Migrations don't run on boot**: `pnpm db:generate` then `pnpm db:migrate` in `server/`; never `docker compose down -v`.
- **Never mix package managers** — pnpm in `server/`/`client/`.

## 6. Execution mode

- **Confirmed with user:** multi-agent.
- Owned paths below are disjoint across every pair of steps that can run concurrently. Two seams were engineered specifically to make that true: (a) all shared client surfaces (`lib/hooks/*`, `messages/en/*`) are pulled forward into **Step 7** so the three UI lanes touch only their own component folders; (b) the server's `evals` module is deliberately **one** step, because `routes.ts`/`service.ts`/`repository.ts` are single files a CRUD/runner/dashboard split would all have to edit — merging is the rule, not a shortcut. Both README inventories are pulled into the final step so no two parallel steps edit them. Steps with no "Depends on" and disjoint paths may be handed to separate `implementer` instances.

**DAG**

```
Step 1 (contracts) ─┬─> Step 3 (pure scorer) ─┐
                     ├─> Step 6 (seed) <────── Step 2 (schema/migration)
                     │                          │
Step 2 ──────────────┴──────────────────────────┴─> Step 4 (evals module) ─┐
Step 5 (agents restoreVersion) ── independent ───────────────────────────┤
Step 1 ─> Step 7 (client data + copy) ─┬─> Step 8  (FindingCard)         ├─> Step 11 (verify + docs)
                                        ├─> Step 9  (Evals tab + modals)  │
                                        └─> Step 10 (Eval Dashboard page) ┘
```
Parallel waves: **{1, 2, 5}** → **{3, 7}** → **{4, 6, 8, 9, 10}** → **{11}**.

## 7. Steps

### Step 1: `EvalExpectation` contract in `@devdigest/shared` (both copies)
- **Type:** cross-cutting
- **Module/package:** `server/` + `client/` vendored shared (pnpm)
- **Owned paths (exclusive):** modified: `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts`
- **What changes:** add the `EvalExpectation` object schema with the shape fixed by the spec's "Contract copies" section — `expect` defaulting to `'must_find'`, `file`, `start_line`, optional `end_line`, and unscored `severity`/`category`/`title` reusing the existing enums from `contracts/findings.ts` rather than restating them. Add the two length caps the spec's "Untrusted inputs" section requires and the given contracts lack: an explicit `.max()` on the expectation array and on `EvalCaseInput.name`. `EvalCaseInput.expected_output` **stays** `z.unknown()` — it is validated as `z.array(EvalExpectation)` at the route boundary (AC 48), so the given contract's field is not reshaped. Both files are `export *`-barrelled; the two copies must be byte-identical for this schema.
- **Skills the implementer will apply:** `zod`, `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** none
- **Tests to run/add:** `cd server && pnpm typecheck`; `cd client && pnpm typecheck`; new case in `server/test/contracts.test.ts` covering the `expect` default, a bare `[]` parsing valid, and the array cap rejecting an over-long input

### Step 2: Additive schema change + migration
- **Type:** backend
- **Module/package:** `server/` (pnpm)
- **Owned paths (exclusive):** modified: `server/src/db/schema/eval.ts`; new: `server/src/db/migrations/00XX_*.sql` + its `meta/` journal entry (generated)
- **What changes:** add nullable `agentVersion` (integer) and `batchId` (uuid) to `evalRuns`; add a unique constraint on `evalCases (ownerId, name)` (AC 7). Add the two indexes the read paths need and Postgres will not create for you: one on `evalRuns.caseId` (FK columns are not auto-indexed) and one on `evalRuns.batchId` (every aggregate groups on it, AC 31). Both new columns stay nullable so the migration is safe against pre-existing rows. Generate with `pnpm db:generate`, apply with `pnpm db:migrate` — never hand-write the SQL, and never `push`.
- **Skills the implementer will apply:** `drizzle-orm-patterns`, `postgresql-table-design`, `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** none (parallel with Step 1)
- **Tests to run/add:** `pnpm db:migrate` against a local Postgres, then `pnpm exec vitest run --exclude '**/*.it.test.ts'`; the migration is exercised for real by Step 4's testcontainers suite

### Step 3: Pure scoring + deterministic case-name helpers
- **Type:** backend
- **Module/package:** `server/` (pnpm)
- **Owned paths (exclusive):** new: `server/src/modules/evals/helpers.ts`, `server/src/modules/evals/constants.ts`, `server/test/evals-scoring.test.ts`
- **What changes:** exported, DB-free, container-free functions implementing ACs 36-46 exactly: the match rule (equal `file` **and** intersecting `[start_line, end_line]`, with a missing `end_line` treated as `start_line`), recall, precision, the `must_not_flag`-wins precedence including the recall denial, `pass`, and the four degenerate `= 1` cases. `citation_accuracy` is a function of `(keptCount, droppedCount)` **passed in** — the scorer never sees a `ReviewOutcome`, because the pre-gate total does not exist on the findings array. Also here: the deterministic case-name derivation (title slug + `file:start_line`, AC 13) and the `constants.ts` job kind / rate-limit / array-cap values.
- **Skills the implementer will apply:** `typescript-expert`, `zod`, `security`, `engineering-insights`
- **Depends on:** Step 1 (uses the `EvalExpectation` type)
- **Tests to run/add:** `pnpm exec vitest run test/evals-scoring.test.ts`; new tests must cover each degenerate case and the double-match precedence pair (ACs 42-43) — the spec's own edge-case example (`must_find` at `a.ts:10-20`, `must_not_flag` at `a.ts:18-25`, actual at `a.ts:15-19` ⇒ fails) is the fixture to encode. Done = every AC 36-46 branch has a named assertion.

### Step 4: The `evals` server module — CRUD, finding→case, async batch runner, dashboards
- **Type:** backend
- **Module/package:** `server/` (pnpm)
- **Owned paths (exclusive):** new: `server/src/modules/evals/{repository.ts,service.ts,runner.ts,routes.ts}`, `server/test/evals-cases.it.test.ts`, `server/test/evals-runs.it.test.ts`, `server/test/evals-dashboard.it.test.ts`; modified: `server/src/modules/index.ts`, `server/src/platform/jobs.ts` (per-kind `timeoutMs` support, needed for the settled timeout decision below — no other step touches this file) (one import + one registry entry)
- **What changes:**
  - **repository.ts** — the only `drizzle-orm` surface for `eval_cases`/`eval_runs`: workspace-scoped case CRUD, a finding-context read (finding → review → agent → PR → `pr_files.patch`) for ACs 11/12/15/16, run inserts, batch grouping on `batch_id`, dashboard trend/recent-run reads, and a `jobs`-status read mirroring `OnboardingRepository.getJobStatus` for ACs 21/24.
  - **service.ts** — case CRUD with `409` on the `(owner_id, name)` unique violation (AC 7), the idempotent finding→case path (`200` + existing case on a repeat click, AC 14; `400` when neither `accepted_at` nor `dismissed_at` is set, AC 17; `400` naming the missing patch when `pr_files.patch` is null, AC 18), dashboard aggregation including `delta` (`0`s on a single run, AC 65) and the negative-precision `alert` (AC 66), and `since` parsing that rejects a non-ISO value with `422` (AC 63).
  - **runner.ts** — job-handler registration and the batch body: generate `batch_id`, read `agents.version` at dispatch, enqueue via `container.jobs.enqueue`, `400` without enqueuing when the agent has zero cases (AC 33); per case, parse `input_diff` with `parseUnifiedDiff`, call `reviewPullRequest` with system prompt + model + diff + the agent's own linked skills and nothing repo-derived (ACs 26-27), score with Step 3's helpers using `outcome.review.findings.length` / `outcome.dropped.length`, persist exactly one row stamped `batch_id` + `agent_version` + `cost_usd` from `outcome.costUsd`, publish per-case progress on `container.runBus` keyed by `batch_id` and `complete()` at the end, and catch **per case** so one failure writes `pass = false` and the batch continues (AC 34). **Timeout decision (settled, §9):** register the eval job kind with its own generous `timeoutMs` (e.g. 10 min) via a new per-kind option on `JobRunner.register`/`enqueue` (`platform/jobs.ts`, small additive change — other kinds keep the 120s default); `GET /agents/:id/eval-runs/:batchId` derives completion from the count of `eval_runs` rows for that `batch_id` against the case-set size, consulting `jobs.status` only for `queued`/`running`/a pre-any-row `failed` — so status never contradicts what's actually on disk even if a timeout is hit.
  - **routes.ts** — the nine routes with Zod `params`/`body` from `@devdigest/shared`, no hand-rolled `Schema.parse`: `GET/POST /agents/:id/eval-cases`, `PUT/DELETE /eval-cases/:id`, `POST /eval-cases/:id/run` (sync, `200 EvalRunResult`), `POST /findings/:id/eval-case`, `POST /agents/:id/eval-runs` (`202` + job id + `batch_id`), `GET /agents/:id/eval-runs/:batchId`, `GET /agents/:id/eval-dashboard`, `GET /eval-dashboard`. Both LLM-triggering POSTs carry `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`. `expected_output` is validated as `z.array(EvalExpectation)` here (AC 48 ⇒ `422`).
- **Skills the implementer will apply:** `backend-onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `zod`, `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** Steps 1, 2, 3
- **Tests to run/add:** `pnpm exec vitest run --exclude '**/*.it.test.ts'` then `pnpm exec vitest run .it.test`. New: cases suite (CRUD, `409` duplicate name, `404` cross-workspace, `422` malformed `expected_output`); finding→case suite (accepted ⇒ `must_find`, dismissed ⇒ `must_not_flag`, repeat click ⇒ `200` same id, un-actioned ⇒ `400`, missing patch ⇒ `400`); runs suite (`202` shape, transitional status observed on an immediate `GET` **with no artificial delay** per `server/INSIGHTS.md` 2026-08-23, aggregate after `jobs.onIdle()`, one failing case doesn't abort the batch, zero cases ⇒ `400` and `MockLLMProvider.calls` stays empty); dashboard suite (`since` filtering, `422` on a bad `since`, single-run zero delta, negative-precision alert). Done = a `POST /agents/:id/eval-runs` against a mocked provider yields a `GET .../eval-runs/:batchId` aggregate whose `per_trace` has one entry per case.

### Step 5: `restoreVersion` + the Promote endpoint
- **Type:** backend
- **Module/package:** `server/` (pnpm)
- **Owned paths (exclusive):** modified: `server/src/modules/agents/service.ts`, `server/src/modules/agents/routes.ts`; new: `server/test/agents-restore-version.it.test.ts`
- **What changes:** `AgentsService.restoreVersion(workspaceId, agentId, version)` composing the existing `getVersion()` + `update()`, restoring exactly the seven fields `update()`'s patch accepts (AC 58) and explicitly **not** `skills`/`context_docs`. `config_json` is untyped `jsonb`, so the snapshot is parsed defensively and a malformed/partial snapshot **fails the promote loudly** rather than writing a half-parsed config onto a live agent (spec, "Untrusted inputs"). Its JSDoc must state the config-only scope by name — the failure mode being designed out is a partial revert behind a label promising a whole one (`server/INSIGHTS.md` 2026-08-26). Route: `POST /agents/:id/versions/:version/restore` → `200 Agent`, `404` when the agent isn't in the caller's workspace or the version doesn't belong to it.
- **Skills the implementer will apply:** `backend-onion-architecture`, `fastify-best-practices`, `zod`, `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** none (fully parallel with Steps 1-4)
- **Tests to run/add:** `pnpm exec vitest run .it.test`; new: promote v1 after a config edit leaves `agents.version` **greater** than before with no historical row mutated (AC 57), linked skills unchanged (AC 58), `404` for another workspace's agent and for an unknown version

### Step 6: Seed ≥8 eval cases for the demo agent
- **Type:** backend
- **Module/package:** `server/` (pnpm)
- **Owned paths (exclusive):** modified: `server/src/db/seed.ts`; new: `server/src/db/fixtures/eval-cases.ts`
- **What changes:** seed at least 8 frozen cases for the Security Reviewer (AC 1), spanning both directions — several `must_find` and at least one `must_not_flag` — each with a small self-consistent `input_diff` whose hunks actually contain the expected lines (an expectation outside every hunk is unpassable by construction; spec, Edge cases). Idempotent on `(owner_id, name)`. Note the seed trap from `server/INSIGHTS.md` 2026-08-12: `seed.ts` writes with direct `db.insert()`, bypassing repository side effects — acceptable here because `eval_cases` has none, but the unique constraint from Step 2 must be respected by using an explicit conflict strategy rather than assuming a clean DB.
- **Skills the implementer will apply:** `drizzle-orm-patterns`, `zod`, `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** Steps 1, 2
- **Tests to run/add:** `pnpm db:seed` twice in a row against a migrated DB (second run must not error); done = `GET /agents/<security-reviewer>/eval-cases` returns ≥8

### Step 7: Client data layer + all i18n copy (gating step for the three UI lanes)
- **Type:** ui
- **Module/package:** `client/` (pnpm)
- **Owned paths (exclusive):** new: `client/src/lib/hooks/evals.ts`; modified: `client/src/lib/hooks/index.ts`, `client/src/lib/hooks/agents.ts` (adds `useRestoreAgentVersion` only), `client/messages/en/eval.json`, `client/messages/en/prReview.json`
- **What changes:** TanStack Query hooks for every endpoint in Steps 4 and 5 — case list/create/update/delete, single-case run, finding→case, batch dispatch + batch read (with polling while the batch is `queued`/`running`), per-agent and workspace dashboards with the `since` parameter, and the promote mutation — each building its path inline against the generic `api.*`, with explicit cache invalidation. **No new functions in `api.ts`** (`client/INSIGHTS.md` 2026-08-17). Types come from `@devdigest/shared`; nothing is redeclared. Plus all eight missing i18n keys: the spec's four (`eval.compare.*` including the AC 59 wording **"Promote prompt & model v{n}"**, `caseEditor.tabs.files`, a date-range label, and `prReview.finding.turnIntoEvalCase`) and the four found in review (Run-on-save toggle, finding-skeleton helper, out-of-hunk warning, Run-all-agents confirmation naming the case count). `messages/` has exactly one locale (`en`), so there is no second file to keep in sync.
- **Skills the implementer will apply:** `frontend-architecture`, `react-best-practices`, `next-best-practices`, `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** Step 1
- **Tests to run/add:** `cd client && pnpm typecheck`; hooks are exercised through the components in Steps 8-10 rather than via `renderHook` (they are plain fetch/mutation hooks — the `react-testing-library` skill's rule). Done = `pnpm typecheck` clean and every key referenced by Steps 8-10 resolves.

### Step 8: "Turn into eval case" on the finding action row
- **Type:** ui
- **Module/package:** `client/` (pnpm)
- **Owned paths (exclusive):** modified: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/{FindingCard.tsx,FindingCard.test.tsx,styles.ts,constants.ts}`
- **What changes:** a third action button rendered **immediately after Dismiss** (AC 8's "before Learn" is stale — there is no Learn affordance and the non-goals forbid adding one). It calls the Step 7 hook directly rather than widening `onAction`, because `FindingActionKind` is a shared contract whose `learn`/`reply` members `actOnFinding` rejects — this action targets a different endpoint and must not be smuggled into that enum. Disabled with a reason when the finding is neither accepted nor dismissed (mirrors the server's AC 17 `400`), success and the already-exists case both read as success. No `dangerouslySetInnerHTML`; icon-only affordances get an `aria-label`.
- **Skills the implementer will apply:** `frontend-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`, `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** Step 7
- **Tests to run/add:** `cd client && pnpm test`; extend the existing `FindingCard.test.tsx` with one flow test per direction (accepted ⇒ creates a case and shows confirmation; un-actioned ⇒ control disabled), using `fireEvent` — `@testing-library/user-event` is not a dependency of this package

### Step 9: Agent editor — Evals tab, case editor modal, Compare-runs modal
- **Type:** ui
- **Module/package:** `client/` (pnpm)
- **Owned paths (exclusive):** new: `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/**` (including `_components/CaseEditorModal/**` and `_components/CompareRunsModal/**`); modified: `client/src/app/agents/[id]/_components/AgentEditor/{AgentEditor.tsx,constants.ts,AgentEditor.test.tsx}`
- **What changes:** a fourth `evals` entry in `TABS` only — `VALID_TABS` is already derived from it, so the page-level allowlist drift that bounced the Context tab cannot recur. The tab renders the last run's four metrics plus the case list with per-case pass/fail and an explicit never-run state (AC 69), "Run all evals" dispatching the batch and following progress, and per-case Run/Edit/Delete. **Case editor modal:** name, a three-tab input strip (Diff / Files / PR meta, AC 77), a raw-JSON expected-output textarea that shows the invalid-JSON state and disables Save while unparseable (AC 74), the skeleton-insert helper (AC 75), a Run-on-save toggle (AC 76 — the deliberate exception to the app's auto-save-on-click model, per `client/INSIGHTS.md` 2026-08-12; every other toggle here auto-saves), and a non-blocking out-of-hunk warning at save time computed with `reviewer-core`'s exported `buildLineIndex` (ACs 78-79). **Compare modal:** enabled only at exactly two selected runs (AC 52), four metric deltas signed, a line-level system-prompt diff when the two `agent_version`s differ (AC 50) and an explicit "configuration is identical" statement when they don't (AC 51), and a per-side Promote control enabled only when that side's version differs from the live one (ACs 54-55), labelled from the AC 59 key. The skill-side placeholder at `skills/[id]/.../EvalsTab/EvalsTab.tsx` is **not** touched.
- **Skills the implementer will apply:** `frontend-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`, `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** Step 7 (Step 5 fixes the promote endpoint's contract but is not a code dependency)
- **Tests to run/add:** `cd client && pnpm test`. New: `EvalsTab.test.tsx` (cases render with a never-run case not shown as failing; Run all dispatches), `CaseEditorModal.test.tsx` (invalid JSON disables Save; a valid save persists and, with Run-on-save on, runs), `CompareRunsModal.test.tsx` (Compare disabled at 1 and 3 selections; same-version shows the identical-config message; Promote disabled on the live-version side). Done = clicking the Evals tab in `AgentEditor.test.tsx` renders it (guards against the `?tab=` allowlist regression).

### Step 10: Eval Dashboard page + sidebar entry
- **Type:** ui
- **Module/package:** `client/` (pnpm)
- **Owned paths (exclusive):** new: `client/src/app/eval/page.tsx`, `client/src/app/eval/_components/EvalDashboardView/**`; modified: `client/src/vendor/ui/nav.ts`
- **What changes:** a thin `page.tsx` rendering one `"use client"` view (any file importing `@devdigest/ui` must be a Client Component or the whole app 500s). The view lists every enabled agent with its latest metrics and pass fraction (AC 70), renders the metric trend and recent-runs table from the workspace dashboard, shows `eval.dashboard.noRuns` instead of zeroed tiles for an agent with no runs (AC 67), exposes the `since` date-range control (AC 62), and gates "Run all agents" behind a confirmation naming the total case count across every set — dismissing it enqueues nothing and issues no LLM call (ACs 72-73). One `NAV` item under `SKILLS LAB` with key `"eval"`, href `/eval`, label "Eval Dashboard" — editing `nav.ts` directly is the settled convention, and `activeKeyFor` already handles `/eval`, so `app-shell/helpers.ts` needs no change.
- **Skills the implementer will apply:** `frontend-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library`, `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** Step 7
- **Tests to run/add:** `cd client && pnpm test` + `pnpm build`; new `EvalDashboardView.test.tsx` (agents render with metrics; empty state for a run-less agent; dismissing the Run-all confirmation fires no mutation). Because `next build` did **not** reproduce the last Server/Client boundary crash (`client/INSIGHTS.md` 2026-08-10), done also requires booting `pnpm dev` and loading `/eval` and `/` for real.

### Step 11: `pnpm verify:l06` + README inventories
- **Type:** cross-cutting
- **Module/package:** repo root (no package manager — scripts-only `package.json`), plus doc edits in `server/`/`client/`
- **Owned paths (exclusive):** new: `package.json` (root), `scripts/verify-l06.sh`; modified: `server/README.md`, `client/README.md`
- **What changes:** a root `package.json` marked `"private": true` with no dependencies (so it does not turn the repo into a workspace — `AGENTS.md`'s "not a monorepo workspace" rule stands, and no root lockfile is created) exposing `verify:l06` → `./scripts/verify-l06.sh`. The script runs `server` typecheck + full test (hermetic and `.it.test`) and `client` typecheck + test, then asserts the four gates explicitly and prints one pass/fail line each: **(1)** the seeded set reaches ≥8 cases; **(2)** one-click creation works for both directions; **(3)** an agent config change plus a re-run moves recall/precision between two runs — driven by the hermetic `server/test/evals-runs.it.test.ts` scenario with `MockLLMProvider` returning different findings across an `agents.version` bump, so it needs no keys and works in CI (`server-integration.yml` has none); **(4)** a scoring-only path records **zero** provider calls, asserted against `MockLLMProvider.calls.length` rather than argued. Gates 1-4 are implemented as named tests owned by Steps 4/6 and merely *invoked* by this script, so the script does not duplicate assertions. Finally, both README route/hook inventories gain the new endpoints, hooks, and pages — pulled here so no two parallel steps edit the same doc.
- **Skills the implementer will apply:** `typescript-expert`, `security`, `engineering-insights`, plus `mermaid-diagram` for `server/README.md`'s module map (per `.claude/skills/pr-self-review/references/skill-scope-map.md`)
- **Depends on:** Steps 4, 5, 6, 8, 9, 10
- **Tests to run/add:** `pnpm verify:l06` ends green from a clean checkout after `./scripts/dev.sh --db-only`

## 8. Cross-cutting concerns

- **Contract → consumer ordering.** Step 1 gates Steps 3, 4, 6, 7. The two `eval-ci.ts` copies must be updated in the same step; nothing fails loudly when they drift.
- **Migration ordering.** Step 2 must be applied (`pnpm db:migrate`) before Step 4's `.it.test.ts` suites can pass; `relation ... does not exist` means the migration was skipped, not a logic bug.
- **`batch_id` as an SSE key.** The run bus is keyed by an arbitrary string and `GET /runs/:id/events` performs no DB lookup, so eval progress streams over the existing route. Consequence to document in Step 4's route comment: a "run id" in that URL is now sometimes a batch id.
- **No feature flag.** Every surface is additive; the only pre-existing UI touched is one button on `FindingCard` and one tab in `AgentEditor`.
- **`cost_usd` is already computed** end-to-end and summed onto `ReviewOutcome.costUsd` — surfacing it per eval run costs zero extra calls and must never introduce a pricing lookup (root `INSIGHTS.md` 2026-08-01).
- **After-task insights.** Per root `AGENTS.md`, each lane records to its module's `INSIGHTS.md` (server work → `server/INSIGHTS.md`; client → `client/INSIGHTS.md`; Step 1 and Step 11 → **root**, since `vendor/shared` and repo-level scripts are cross-package). No `INSIGHTS.md` is listed in any step's Owned paths, because they are appended at the end of a session, not edited as part of the change — flag this to whoever runs the lanes so two agents don't append to the same file concurrently.

## 9. Recommendations

- **Decided:** the batch job handler gets a per-kind timeout, and status is derived from rows, not from `jobs` alone. `container.jobs` is constructed as bare `new JobRunner(db)` (`platform/container.ts:93`), so it inherits `timeoutMs = 120_000`, `retries = 2`, `concurrency = 3` (`platform/jobs.ts:39-41`). An 8-case batch of real review calls will exceed 120s. `withTimeout` is a `Promise.race` (`platform/resilience.ts:13-24`) — it rejects but **does not cancel** the handler, so the batch keeps running and keeps writing `eval_runs` rows and spending, while the `jobs` row is already `failed`. (Verified: `defaultIsRetryable` returns `false` for `TimeoutError`, so there is no retry storm — the failure is "job says failed while work continues", not triple spend.) Fix, in Step 4's scope: (a) `JobRunner.register`/`enqueue` accepts a per-kind `timeoutMs`; the eval kind registers a much larger one (e.g. 10 min, generous enough for 8+ sequential LLM calls) — a small, contained addition to `platform/jobs.ts`; and (b) the batch-status read (`GET /agents/:id/eval-runs/:batchId`) derives completion from `eval_runs` rows for that `batch_id` (count of rows vs. case-set size) rather than trusting `jobs.status` alone — `jobs.status` is consulted only for the `queued`/`running`/`failed`-before-any-row-written states. This keeps AC 24 honest even if the timeout is ever hit in practice.
- **Note the concurrency cost:** `p-queue` concurrency is 3 across *all* job kinds (clone, index, polling, onboarding). One long eval batch occupies a third of the queue for minutes. Not a blocker, worth a comment on the job kind.
- **The runner should pass the agent's linked skills but record that it did.** ACs 26-27 say "the agent's own configuration alone" and forbid repo-derived enrichment; skills are agent config, so they belong in the call — but skills are edited independently of `agents.version`, so two runs at the same recorded version can still differ. The spec already accepts this for promote (Edge cases, "Promoting an old version whose skills have since changed"); the plan just shouldn't pretend `agent_version` is a complete provenance key.
- Otherwise the request's scope is the right one — the spec's 18 resolutions already cut the obvious excess (no LLM judge, no skill-side eval, no CI runs, no auto-mined cases).

## 10. Out of scope / explicitly deferred

- Any change to `reviewer-core/` — confirmed read-only: `groundFindings`, `buildLineIndex`, `reviewPullRequest` and the `grounding`/`dropped`/`costUsd` fields are all already exported.
- Any change to `reviews/` (spec's module-ownership decision) and to the skill-side `EvalsTab` placeholder.
- The `Learn` / `Reply to author` finding actions, and the `Stats` / `CI` agent-editor tabs.
- Running evals in CI, on a schedule, or on a webhook; auto-mining historical decisions into cases.
- Redesigning `eval_cases`/`eval_runs` or any of the nine given contracts beyond the three agreed additive changes.
- A cost estimate in the Run-all confirmation (case count only), a cap on batch size or spend, and any guard against two concurrent batches for the same agent — all named and accepted in the spec's Edge cases.
- `e2e/` browser flows for these surfaces, and `mcp-server/` exposure of eval tools.

## 11. Open questions / risks

- **Job timeout vs. batch duration — resolved, see §9.** Per-kind `timeoutMs` on the eval job kind, batch status derived from `eval_runs` rows rather than `jobs.status` alone. Folded into Step 4's scope; no longer open.
- **Deleting a case rewrites history** — the `onDelete: 'cascade'` FK removes that case's runs, retroactively changing the trend chart. The spec accepts this ("best-effort history, not an audit log"); worth one line in the dashboard copy so a user isn't surprised.
- **Orphaned cases** — `eval_cases.owner_id` is a bare `uuid` with no FK to `agents`, so deleting an agent silently orphans its cases, which still count toward workspace aggregates. Step 4's `GET /eval-dashboard` should skip owners that no longer resolve to an enabled agent rather than emitting a nameless row — planned as "skip"; flag if the owner wants them surfaced instead.
- **No external unknowns** — every library and API this plan touches is already in the repo, so there is nothing to hand to the `researcher` agent.

## 12. Suggested review path (not performed here)

- Before PR: the `pr-self-review` skill (root `AGENTS.md`); it blocks on CRITICAL findings and will map this diff onto `backend-onion-architecture`, `frontend-architecture`, and `security`.
- A dedicated security review is warranted: this feature persists untrusted PR content and feeds it back into a prompt (ASI01 / OWASP A05, mitigated only by routing through `reviewPullRequest`), adds a write against `agents` from a comparison screen (A01), and introduces IDOR surface on a bare `owner_id` with no FK.
- Architecture sign-off on §5's non-trivial constraints — specifically the `/findings/:id/*` prefix now being served by two plugins, and whichever job-timeout resolution is picked in §9.

---

**Short step list:** 1 contracts · 2 schema+migration · 3 pure scorer · 4 evals module · 5 agents restoreVersion+route · 6 seed ≥8 cases · 7 client hooks+i18n (gates the UI lanes) · 8 FindingCard button · 9 Evals tab + case editor + compare modals · 10 Eval Dashboard page + nav · 11 `verify:l06` + READMEs. Waves: {1,2,5} → {3,7} → {4,6,8,9,10} → {11}.
