# Development Plan: SPEC-01 Project Context

> Produced by the `implementation-planner` subagent against
> `specs/01-project-context.md` (SPEC-01, `Status: approved`). Execution mode
> confirmed with the user: **single-agent**. This document is a plan, not a
> specification — it does not supersede or amend SPEC-01.

## 1. Summary
Wire up the Project Context feature end-to-end: discover Markdown documents in a
repo's clone, let a user attach them to an agent or a skill as `(repo_id, path)`
pairs, read them fresh at run time, and inject them into `reviewer-core`'s
already-existing but never-fed `specs` prompt slot so the reviewing agent judges
a diff against the documents that define what the codebase is supposed to do —
with the run trace showing exactly what was injected. The engine half of this
ships today and is unfed; the browse/attach half is contract-and-copy-only
scaffolding with zero routes behind it. This plan is mostly about **connecting
five already-present layers**, not inventing them.

## 2. Requirements reviewed
- **Supplied:** `specs/01-project-context.md` (SPEC-01, `Status: approved`), read
  in full. 13 open questions, 12 resolved with the product owner on 2026-08-23,
  and a Non-functional-requirements section that already names most of the
  constraints below with `path:line` citations. `specs/README.md` confirms the
  template and that `approved` means agreed-to-build.
- No module-level `<module>/specs/` file exists for this feature —
  `server/specs/` holds only a `README.md`.
- **Ambiguities found and resolved this session** (one clarifying round, answers
  received):
  1. **Spec's `/repos/:repoId/agents/:agentId` route does not exist.** The agent
     editor is at `client/src/app/agents/[id]/`, the skill editor at
     `client/src/app/skills/[id]/` — both workspace-scoped. **Resolved:** keep
     the editors where they are; the Context tab/section reads `repoId` from
     `client/src/lib/repo-context.tsx` (already resolves URL path > `localStorage`
     > first repo) and renders disabled/empty when no repo is active. No new
     routes.
  2. **Q4's `**/INSIGHTS.md` search root is not covered by the shared path
     allowlist** `isAllowedPlanRefShape` (`server/src/modules/reviews/intent.ts:236-241`
     matches only `specs/*.md`, `docs/**/*.md`, `docs/plans/**`). **Resolved:**
     add a project-context-local shape allowlist composing the *unchanged*
     exported `isWithinClone`; do not widen `isAllowedPlanRefShape` itself, so
     the intent layer's resolution of paths out of untrusted PR bodies is
     unaffected.
  3. **Q6 leaves "Used by N agents" half-open** (does skill-inherited usage
     count?). **Resolved:** deferred out of scope for this plan, bundled with the
     already-deferred "COVERAGE" badge. No step for it.

## 3. Context reviewed
- `specs/01-project-context.md` — the approved requirement; its "Non-functional
  requirements" section is effectively a pre-written constraints list.
- `server/specs/README.md`, `client/docs/README.md`, `server/docs/README.md`,
  `reviewer-core/docs/README.md` — no per-module spec or doc for this feature.
- `INSIGHTS.md` (root) — **highly relevant.** The 2026-08-12 "Codebase Patterns"
  entry is literally about this feature, updated 2026-08-23 while speccing it: it
  names all five disconnected layers and the two traps (repo-vs-workspace
  scoping; `context.json` encoding a `.devdigest/specs/` layout). Also
  load-bearing: 2026-08-04 (`server/src/vendor/shared` and
  `client/src/vendor/shared` are two independent copies, nothing fails loudly on
  drift) and 2026-08-18 (`.default([])` on a contract does *not* make it safe —
  grep hand-built literals).
- `server/INSIGHTS.md` — relevant: `GitClient.readFile` has **no traversal guard**
  (2026-08-18, `src/adapters/git/simple-git.ts:135-136`); `agent_skills`
  full-replace needed `.onConflictDoUpdate`, a transaction alone 500s
  (2026-08-12); `saveRunTrace` must precede `completeAgentRun` on all three paths
  (2026-08-19); `@fastify/rate-limit` is not registered when `NODE_ENV==='test'`
  (2026-08-18).
- `client/INSIGHTS.md` — relevant: no batched toggle-then-Save, every toggle
  auto-saves (2026-08-12); `@testing-library/user-event` is **not** a dependency,
  use `fireEvent` (2026-08-17); any file importing `@devdigest/ui` must be
  `"use client"` (2026-08-10); `src/lib/api.ts` never grows per-endpoint wrappers
  (2026-08-17).
- `reviewer-core/INSIGHTS.md` — relevant: a trace field must mirror its source
  slot's base name (`pr_intent` → `intent` rename, 2026-08-18/20). This feature
  adds no new slot, so it inherits `specs`/`specs_read` unchanged.
- `AGENTS.md` conventions relevant here: contracts change in `@devdigest/shared`
  first then consumers; server modules are one `src/modules/<name>/` plugin
  registered in `src/modules/index.ts`; `*.it.test.ts` are DB-backed, everything
  else hermetic; `server/clones/**` is do-not-touch and excluded from search;
  `reviewer-core` emits no JS and forbids filesystem access.
- Existing patterns referenced:
  - `reviewer-core/src/prompt.ts:101-104,124` — `specsBlock` maps
    `parts.specs` through `wrapUntrusted('spec-N', …)` and pushes
    `## Project context`. Verified present and correct. **Zero changes needed here.**
  - `server/src/modules/reviews/run-executor.ts:216-244` — the omit-when-empty
    spread pattern (`...(skillBodies.length > 0 ? { skills: skillBodies } : {})`)
    that `specs` must copy exactly; `:317` hardcodes `specs_read: []`.
  - `server/src/modules/reviews/intent.ts:236-256` — exported
    `isAllowedPlanRefShape` / `isWithinClone` / `isSafePlanRefPath`; `isWithinClone`
    is the reusable half.
  - `server/src/modules/repo-intel/pipeline/walk.ts` — `walkClone(root)` already
    skips symlinks outright, applies `EXCLUDED_DIRS` and `MAX_FILE_SIZE`, and
    returns posix relpaths; it filters to `SUPPORTED_SET` and takes no options.
  - `server/src/adapters/tokenizer/index.ts` — `Tokenizer` interface,
    `TiktokenTokenizer`, `approxTokens` never-throw fallback; wired at
    `server/src/platform/container.ts:139-142`.
  - `server/src/modules/agents/routes.ts:145,152` — `GET`/`POST /agents/:id/skills`,
    the exact attach-list shape to mirror.
  - `server/src/modules/conventions/routes.ts:26` — `GET /repos/:id/conventions`,
    the repo-scoped route precedent.
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx:89-96,161-176`
    — attach/detach/reorder with immediate persist, native HTML5 drag **plus**
    up/down `Icon.ArrowUp`/`ArrowDown` buttons. No dnd library involved.
  - `client/src/lib/hooks/core.ts:123-138` — `useContextFiles` /
    `useReindexContext`, already written against the endpoints this plan builds.
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`
    — already renders the `specsRead` config row and the `prompt.specs` block.

## 4. Modules affected
| Module | Package manager | Why touched |
|---|---|---|
| `server/src/vendor/shared` (`@devdigest/shared`) | pnpm (via `server/`) | `SpecFile` gains type + tokens; `RunTrace.specs_read` element type changes; new `SpecPath` / `SetContextDocsBody` / list-envelope schemas; `AgentVersionConfig.context_docs` |
| `client/src/vendor/shared` | pnpm (via `client/`) | Independent second copy of the above — must be hand-copied (root `INSIGHTS.md`, 2026-08-04) |
| `server/` | pnpm | New `context` module (discovery/preview), attach routes on `agents`+`skills`, DB schema + migration, run-time injection in `run-executor.ts`, parameterized `walkClone` |
| `client/` | pnpm | Project Context page, Agent editor Context tab, Skill editor Context section, hooks, i18n corrections, trace drawer shape update |
| `reviewer-core/` | npm | **No changes.** Listed only to make the zero explicit — the `specs` slot, its heading, its `wrapUntrusted` fencing and its `PromptAssembly.specs` output all already exist (`reviewer-core/src/prompt.ts`). Any diff here is a red flag. |

## 5. Architectural constraints
- **Contracts first, in both copies.** `server/src/vendor/shared/` and
  `client/src/vendor/shared/` are two independent copies; nothing fails loudly
  when they drift. Diff the specific file before copying — don't sync wholesale
  (root `INSIGHTS.md`, 2026-08-04).
- **Onion layering, no exceptions for the new module.** The new `context` module
  starts with all three of `routes.ts` / `service.ts` / `repository.ts` even if
  the repository is thin — `settings`/`polling`/`pulls`/`workspace` are flat and
  are debt, not the pattern to copy (`backend-onion-architecture` skill).
  Filesystem access goes through `container.git` / the tokenizer adapter, never
  from a route.
- **Zod at the boundary, never `Schema.parse(req.body)`.** A traversal payload
  must be rejected `422` *before* the handler runs, via `fastify-type-provider-zod`
  (`server/AGENTS.md`; `server/INSIGHTS.md` 2026-07-31).
- **Guard at both ends.** A path is untrusted on the way in *and* on the way back
  out of the DB — re-guard immediately before every `readFile`. `GitClient.readFile`
  offers no protection of its own (`server/src/adapters/git/simple-git.ts:135-136`).
- **`reviewer-core` purity.** Discovery, reading and token counting are I/O and
  belong in `server/`. `reviewer-core` changes = 0.
- **Degrade, never fail.** Project context follows `buildCallersDigest` /
  `buildRepoMapDigest`: any failure yields `undefined` and the prompt collapses
  to the pre-feature shape. A missing clone, an unreadable file, or an empty
  attachment set must produce a **byte-identical** prompt to today's.
- **Trace before status.** `saveRunTrace` must keep running before
  `completeAgentRun` on all three paths (success, catch, `failAll`) — reversing
  it caused a reproducible race (`server/INSIGHTS.md`, 2026-08-19).
- **Client: hooks-only data access**, TanStack Query for server state, no
  per-endpoint wrappers in `src/lib/api.ts`, `next-intl` for every string, and
  `"use client"` on anything importing `@devdigest/ui`.
- **No new dependency.** No glob package (parameterize `walkClone`), no dnd
  library (reuse `SkillsTab`'s drag + move-buttons), no DOMPurify (`react-markdown`
  escapes by default and must not be given raw-HTML passthrough).

## 6. Execution mode
- **Confirmed with user:** single-agent
- One `implementer` instance runs all eight steps in order. Owned paths below
  document what each step touches but are **not** required to be disjoint — Steps
  1→2→3 and 1→5 have genuine ordering dependencies, stated per step. Steps 6-8
  touch `client/src/lib/hooks/core.ts` in adjacent regions; sequential execution
  makes that a non-issue.

## 7. Steps

### Step 1: Contract changes in `@devdigest/shared` (+ hand-copy to the client)
- **Type:** cross-cutting
- **Module/package:** `server/src/vendor/shared` → `client/src/vendor/shared` (pnpm)
- **Owned paths (exclusive to this step):** modified:
  `server/src/vendor/shared/contracts/platform.ts`, `.../contracts/trace.ts`,
  `.../contracts/knowledge.ts`, and the corresponding three files under
  `client/src/vendor/shared/contracts/`
- **What changes:**
  - `platform.ts` — extend the existing `SpecFile` (currently `path`/`content`/
    `size`/`updated_at` at lines 271-277) with a document-type tag derived from
    the matched search pattern (`specs`/`docs`/`insights`) and a server-computed
    estimated token count. Add the discovery **response envelope** carrying the
    document array plus the `degraded` marker, the summed token total, and the
    last-scan time that the page footer needs (Q5). Add `SpecPath` — a `z.string()`
    refined by the project-context shape allowlist — and `SetContextDocsBody`
    wrapping a bounded `z.array(SpecPath)` capped at the Q8 maximum of 10, so a
    traversal payload is a `422` before any handler runs.
  - `trace.ts` — `RunTrace.specs_read` changes from `z.array(z.string())` (line
    ~96) to an array of objects carrying path + token count (+ a truncation
    flag). Element type only; the field name stays `specs_read` to keep mirroring
    `PromptParts.specs` (`reviewer-core/INSIGHTS.md`, 2026-08-18/20).
    `PromptAssembly` is **unchanged** — `specs` already exists at `trace.ts:43`.
  - `knowledge.ts` — `AgentVersionConfig` (lines 299-308) gains
    `context_docs: z.array(z.string()).default([])` (Q10).
  - **Do not** reuse `IndexStatus`'s `chunks_indexed` for anything — Q5 puts the
    embedding pipeline out of scope.
  - Diff each file individually before copying to the client; the client copy is
    allowed to lag on things it never imports.
- **Trap to handle explicitly:** `agent_versions.config_json` is a **bare
  `jsonb('config_json').notNull()`** with no `.$type<AgentVersionConfig>()`
  (`server/src/db/schema/agents.ts:45`), so the hand-built literal in
  `AgentsRepository.snapshotVersion` (`server/src/modules/agents/repository.ts:148-166`)
  will **not** fail `pnpm typecheck` when `context_docs` is added — and
  `.default([])` will silently make `AgentVersionConfig.parse(row.configJson)` in
  `toAgentVersionDto` (`server/src/modules/agents/helpers.ts:39`) succeed forever
  on snapshots that never contain the field. This is a sharper case of root
  `INSIGHTS.md`'s 2026-08-18 warning: here the compiler is silent in *both*
  directions. Step 4 must fill the literal by hand; a green typecheck is not
  evidence it happened.
- **Skills the implementer will apply:** `zod`, `typescript-expert`, `security`,
  `engineering-insights`
- **Depends on:** none
- **Tests to run/add:** `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`;
  `cd client && pnpm typecheck`. Extend `server/test/contracts.test.ts` with:
  `SpecPath` rejects `../`, an absolute path, a Windows drive-absolute path, and
  a non-`.md` path; `SetContextDocsBody` rejects an over-cap array; a legacy
  `AgentVersionConfig` literal without `context_docs` still parses.

### Step 2: Attachment tables + migration
- **Type:** backend
- **Module/package:** `server/` (pnpm)
- **Owned paths:** new: `server/src/db/schema/context-docs.ts` (or an addition to
  `server/src/db/schema/knowledge.ts` if the implementer judges it belongs with
  agents/skills), generated file(s) under `server/drizzle/`; modified:
  `server/src/db/schema.ts` (barrel re-export)
- **What changes:** two tables — agent-level and skill-level context-document
  attachments — each storing `(agent_id|skill_id, repo_id, path)` plus an
  explicit integer `order`, per Q2. Composite primary key on the full triple so
  the full-replace insert has an exact conflict target. Index the FK columns
  (Postgres does not auto-index them) and the `(owner_id, repo_id)` access path
  the Context tab queries on. `ON DELETE CASCADE` from agent/skill and from repo,
  so deleting a repo takes its attachments with it. `path` is `TEXT` with a
  length `CHECK`, not `VARCHAR(n)`. Generate the migration with `pnpm db:generate`
  — never hand-write one (`server/AGENTS.md`).
- **Skills the implementer will apply:** `drizzle-orm-patterns`,
  `postgresql-table-design`, `backend-onion-architecture`, `typescript-expert`,
  `security`, `engineering-insights`
- **Depends on:** none (independent of Step 1, but sequenced here so Step 3 has a
  table to read)
- **Tests to run/add:** `cd server && pnpm db:generate && pnpm db:migrate`; then
  `pnpm exec vitest run .it.test` to confirm nothing regressed. Migrations do not
  run on boot — `relation … does not exist` means this step was skipped.

### Step 3: `context` module — discovery, preview, reindex
- **Type:** backend
- **Module/package:** `server/` (pnpm)
- **Owned paths:** new: `server/src/modules/context/{routes,service,repository,helpers,constants}.ts`,
  `server/test/context-discovery.test.ts`, `server/test/context-routes.it.test.ts`;
  modified: `server/src/modules/index.ts` (one import + one registry entry),
  `server/src/modules/repo-intel/pipeline/walk.ts`,
  `server/src/adapters/tokenizer/index.ts` (doc-comment scope only)
- **What changes:**
  - `GET /repos/:repoId/context` returns the discovery envelope; `GET` for a
    single document's text (for preview); `POST /repos/:repoId/context/reindex`
    re-walks the clone and refreshes the list. All three already have client
    hooks written against them.
  - `walkClone` gains an **optional** options parameter (extension set /
    match-predicate + a max-size override) defaulting to today's exact behavior,
    so `pipeline/full.ts` and `pipeline/incremental.ts` compile and behave
    unchanged. Fork it and you own two walkers — parameterize it. `EXCLUDED_DIRS`
    filtering and the existing symlink skip come for free.
  - `helpers.ts` owns the project-context **shape allowlist** — its own regex set
    covering `**/specs/**/*.md`, `**/docs/**/*.md` and `**/INSIGHTS.md` as a file
    (Q4) — composed with the **unchanged** `isWithinClone` imported from
    `server/src/modules/reviews/intent.ts`. Export the combined guard so traversal
    payloads are unit-testable without a real clone, following
    `intent.ts:251-256`'s own precedent. Do not touch `isAllowedPlanRefShape`.
  - Token counting goes through `container.tokenizer`. Widening the adapter's
    documented scope beyond `modules/repo-intel` is deliberate — update its
    doc comment (`server/src/adapters/tokenizer/index.ts:11`) rather than leaving
    it stale.
  - No `clone_path` → empty list + `degraded: true`, **not** an error response.
  - The reindex `POST` gets a per-route `config.rateLimit`, with the caveat that
    it is a no-op under `NODE_ENV==='test'` (`server/INSIGHTS.md`, 2026-08-18).
  - **Not** in scope: any write into the clone, any `code_chunks` writer, any
    embedding or LLM call (Q5, Q9).
- **Skills the implementer will apply:** `backend-onion-architecture`,
  `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `security`,
  `typescript-expert`, `engineering-insights`
- **Depends on:** Step 1 (contracts), Step 2 (tables)
- **Tests to run/add:** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
  then `pnpm exec vitest run .it.test`. New hermetic
  `test/context-discovery.test.ts`: the shape allowlist accepts `specs/x.md`,
  `docs/a/b.md`, `INSIGHTS.md`, `server/INSIGHTS.md` and rejects `../etc/passwd`,
  `/etc/passwd`, `C:\x`, `notes.txt`; the parameterized `walkClone` with no
  options returns exactly what it returns today. New
  `test/context-routes.it.test.ts`: list against a fixture clone, single-document
  read, and the no-clone degraded path.

### Step 4: Attach / detach routes on agents and skills
- **Type:** backend
- **Module/package:** `server/` (pnpm)
- **Owned paths:** modified:
  `server/src/modules/agents/{routes,service,repository}.ts`,
  `server/src/modules/skills/{routes,service,repository}.ts`; new:
  `server/test/context-attach.it.test.ts`
- **What changes:** `GET`/`PUT` (full-replace) of an agent's and a skill's
  attached document set, scoped to a repo, mirroring the existing
  `GET`/`POST /agents/:id/skills` pair at `server/src/modules/agents/routes.ts:145,152`.
  Body validated by `SetContextDocsBody` at the boundary, so a bad path is `422`
  before the handler. Response marks any persisted path that discovery no longer
  finds as **missing** rather than dropping it, and the server never auto-deletes
  such a row (Q7). Skill-level lists are ordered deterministically by normalized
  path with no order column semantics (Q13); agent-level carries the explicit
  order.
  **The full-replace insert must use `.onConflictDoUpdate` on the composite PK.**
  A `db.transaction()` alone is not sufficient — `DELETE` against zero existing
  rows takes no lock, so two concurrent attach requests for a fresh agent both
  no-op the delete and the second `INSERT` 500s on the PK (`server/INSIGHTS.md`,
  2026-08-12, reproduced against `agent_skills`).
  Also in this step: fill `context_docs` in `snapshotVersion`'s hand-built
  literal (`server/src/modules/agents/repository.ts:148-166`) — see Step 1's trap
  note; the compiler will not tell you if you forget.
- **Skills the implementer will apply:** `backend-onion-architecture`,
  `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `security`,
  `typescript-expert`, `engineering-insights`
- **Depends on:** Step 2, Step 3 (shares the guard helper)
- **Tests to run/add:** `cd server && pnpm exec vitest run .it.test`. New
  `test/context-attach.it.test.ts`: attach → read back in order; a `../` path is
  rejected `422`; two concurrent `PUT`s via `Promise.all` both succeed (no 500 —
  the `agent_skills` regression shape); an attachment made against repo A is
  absent from the same agent's list read against repo B; a new agent version
  snapshot contains `context_docs`.

### Step 5: Run-time injection + trace
- **Type:** backend
- **Module/package:** `server/` (pnpm)
- **Owned paths:** modified:
  `server/src/modules/reviews/run-executor.ts`, `server/src/modules/reviews/constants.ts`;
  new: `server/src/modules/reviews/project-context.ts`,
  `server/test/context-prompt-wiring.it.test.ts`
- **What changes:** a `buildProjectContextDocs()` helper alongside the existing
  `buildCallersDigest` / `buildRepoMapDigest`, following their exact
  degrade-to-`undefined` contract. It: filters the agent's attachments to the
  run's `repo_id` **first**, before anything else touches them (Q2); unions
  agent-level attachments (drag order) with those from linked **enabled** skills
  (mirroring the `l.skill.enabled` filter at `run-executor.ts:203-206`),
  deduplicated by normalized path, agent-first (Q3); re-guards each surviving
  path against the clone; reads each one fresh via `container.git.readFile`;
  truncates at 20 000 chars per document and drops beyond 10 documents / ~60 000
  chars total (Q8), naming every failed and every dropped path in the run's Live
  Log. The result is threaded into `reviewPullRequest` as
  `...(specs.length > 0 ? { specs } : {})` — the same omit-when-empty spread the
  other slots use at `run-executor.ts:226-237`. `specs_read` at `:317` is
  populated with path + token count per injected document, replacing the
  hardcoded `[]`.
  `saveRunTrace`-before-`completeAgentRun` ordering stays untouched on all three
  paths.
- **Skills the implementer will apply:** `backend-onion-architecture`, `security`,
  `zod`, `typescript-expert`, `engineering-insights`
- **Depends on:** Step 1, Step 4
- **Tests to run/add:** `cd server && pnpm exec vitest run .it.test`, and
  `cd reviewer-core && npm run typecheck` to prove the engine is genuinely
  untouched. New `test/context-prompt-wiring.it.test.ts`, modeled on the existing
  `test/skills-prompt-wiring.it.test.ts` (copy its `appWith()` helper's
  `openrouter` mock — without it the file flakes on a machine with a real
  `OPENROUTER_API_KEY`, per `server/INSIGHTS.md` 2026-08-18): an attached
  document appears inside `## Project context` wrapped in
  `<untrusted source="spec-0">`; **with zero attachments the assembled prompt is
  byte-identical to a run with the feature absent**; an attached-then-deleted
  file is skipped, the run still completes `done`, and the Live Log names the
  path; a repo-A attachment contributes nothing to a repo-B run and produces no
  Live Log line.

### Step 6: Project Context page
- **Type:** ui
- **Module/package:** `client/` (pnpm)
- **Owned paths:** new: `client/src/app/repos/[repoId]/context/page.tsx` and
  `client/src/app/repos/[repoId]/context/_components/ProjectContextView/*`
  (`ProjectContextView.tsx`, `ProjectContextView.test.tsx`, `styles.ts`,
  `constants.ts`, `helpers.ts`, `index.ts`); modified:
  `client/src/lib/hooks/core.ts`, `client/messages/en/context.json`,
  `client/src/components/app-shell/*` (nav item)
- **What changes:** a read-only browse/preview/refresh page — document list with
  path, type, size, token estimate; `react-markdown` preview pane; a status
  footer reading "N documents · ~T tokens total · last scanned <time>"; loading,
  `context.loadError`, and `context.empty` states. `useContextFiles` is **extended**
  in place, not duplicated, and keeps building its path inline against the
  generic `api.get` (no wrapper in `src/lib/api.ts`).
  `client/messages/en/context.json` needs correcting, not just extending: its
  `chunks` key is overruled by Q5 and its `empty.body` names `.devdigest/specs/`,
  a layout Q4 replaced with repo-wide `specs/` + `docs/` + `INSIGHTS.md`. Its
  `mode.edit` / `editor.save` / `editor.saving` keys describe the write path Q9
  puts out of scope — leave them unused or remove them, but ship **no** `+`,
  upload, or Edit/Save affordance.
  ~~Nav: the item goes under `SKILLS LAB` with href `/repos/:repoId/context` (Q11).~~
  ~~`client/src/vendor/ui/nav.ts` is do-not-touch, so extend/compose `NAV` in app
  code rather than editing the vendored registry.~~
  **Post-implementation correction (2026-08-23, same day):** `SKILLS LAB` was
  wrong — see the corrected `specs/01-project-context.md` Q11. The nav item
  belongs under `WORKSPACE`, sibling to `Pull Requests`, matching the product
  owner's own design source and the existing `:repoId`-templated href pattern
  Pull Requests already establishes. The "extend/compose `NAV` in app code"
  instruction above also turned out to be unbuildable as stated: the vendored
  `Sidebar.tsx`/`AppFrame.tsx` have no `nav` override prop, and adding one would
  touch three vendored files instead of one — more vendor surface, not less.
  Decision on both: move the item to `WORKSPACE` in `client/src/vendor/ui/nav.ts`
  directly (same file this and the two prior nav-adding features already
  edited), href unchanged at `/repos/:repoId/context`.
  Markdown rendering must not enable raw-HTML passthrough, and links must be
  restricted to `http:`/`https:`.
- **Skills the implementer will apply:** `frontend-architecture`,
  `next-best-practices`, `react-best-practices`, `react-testing-library`,
  `security`, `typescript-expert`, `engineering-insights`
- **Depends on:** Step 1, Step 3
- **Tests to run/add:** `cd client && pnpm typecheck && pnpm test`. New
  `ProjectContextView.test.tsx` — three flow tests per the list-component matrix:
  documents load and selecting one renders its Markdown; empty state; error
  state. Use `fireEvent`, not `user-event` (not a dependency here).
  `next build` + `tsc` passing is **not** sufficient evidence a
  Server/Client boundary is safe — boot `pnpm dev` and hit `/repos/<id>/context`
  (`client/INSIGHTS.md`, 2026-08-10).

### Step 7: Agent Context tab + Skill Context section
- **Type:** ui
- **Module/package:** `client/` (pnpm)
- **Owned paths:** new:
  `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/*`,
  `client/src/app/skills/[id]/_components/SkillEditor/_components/ContextSection/*`;
  modified: `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`
  (add the tab to `TABS`), the equivalent `SkillEditor/constants.ts`,
  `client/src/lib/hooks/agents.ts`, `client/src/lib/hooks/skills.ts`,
  `client/messages/en/{agents,skills}.json`
- **What changes:** both surfaces read the active `repoId` from
  `client/src/lib/repo-context.tsx` and render an empty/disabled state when none
  is active (per the Q1 answer — no new routes). The agent tab shows the
  discovered list with checkboxes, a case-insensitive client-side path filter,
  "N of M attached", a running summed token estimate **sourced from the server's
  count** (not the trace drawer's local `approxTokens`, so editor and trace
  agree), drag + up/down reorder, missing-path rows with a one-click detach, and
  read-only ticked rows for skill-inherited documents (Q3). The skill section is
  the same minus reordering (Q13) and must show `## Project context` in its
  "SERIALIZES AS" preview — **not** the mocked `## Project specifications` (Q1).
  **Every toggle, move and detach persists immediately** from inside the state
  updater using the updater's fresh next value. Do not build a Save button — that
  exact model was built for the Skills tab, read as broken to a real user, and
  removed (`client/INSIGHTS.md`, 2026-08-12).
- **Skills the implementer will apply:** `frontend-architecture`,
  `react-best-practices`, `next-best-practices`, `react-testing-library`,
  `security`, `typescript-expert`, `engineering-insights`
- **Depends on:** Step 4, Step 6
- **Tests to run/add:** `cd client && pnpm typecheck && pnpm test`. New
  `ContextTab.test.tsx`: ticking a document fires the mutation immediately with
  the post-toggle set and the token total updates; filtering narrows the list; a
  missing row renders its marker and its detach control. New
  `ContextSection.test.tsx`: attach persists immediately and the serializes-as
  preview reads `## Project context`.

### Step 8: Trace drawer — new `specs_read` shape
- **Type:** ui
- **Module/package:** `client/` (pnpm)
- **Owned paths:** modified:
  `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`
  and its sibling `styles.ts` / `TraceBody.test.tsx`;
  `client/messages/en/runs.json` if a token-count label is needed
- **What changes:** the `trace.config.specsRead` row currently maps
  `trace.specs_read` as bare strings; it now renders path + token count per
  entry. The `trace.prompt.specs` block already renders `prompt_assembly.specs`
  and needs no change beyond confirming it still shows the exact injected text.
  The "none" placeholder for a run that injected nothing must survive.
- **Skills the implementer will apply:** `frontend-architecture`,
  `react-best-practices`, `react-testing-library`, `typescript-expert`,
  `security`, `engineering-insights`
- **Depends on:** Step 1
- **Tests to run/add:** `cd client && pnpm test`. Extend the existing
  `TraceBody.test.tsx`: a trace with two injected documents lists both with token
  counts; an empty `specs_read` renders the "none" placeholder.

## 8. Cross-cutting concerns
- **Contract sequencing.** Step 1 lands in `@devdigest/shared` before every
  consumer, and both vendored copies move together. A drift here fails silently —
  the client just keeps stale types.
- **`specs_read` is a breaking element-type change** to a field that already
  exists in persisted `run_traces.trace` documents. Historical rows hold
  `string[]`; the new schema expects objects. Decide deliberately between a
  tolerant union on read and accepting that old traces fail to parse — today
  every existing row is `[]` (hardcoded at `run-executor.ts:317`), which likely
  makes this a non-issue, but confirm rather than assume.
- **Migration is manual.** `pnpm db:generate` then `pnpm db:migrate`; migrations
  do not run on boot. Never `docker compose down -v` to reset.
- **No feature flag proposed.** The degrade-to-identical-prompt requirement makes
  the feature inert until a user attaches something, which is a better kill
  switch than a flag.
- **Package managers:** pnpm in `server/` and `client/`, npm in `reviewer-core/`.
  Never cross them.

## 9. Recommendations
- **Reuse `SkillsTab`'s reorder controls rather than adding a drag-and-drop
  dependency.** The spec's user story says "I drag a document above another", and
  `client/package.json` has no dnd library. `SkillsTab.tsx:89-96,140-176` already
  implements exactly this with native HTML5 drag on a grip **plus** accessible
  up/down `Icon.ArrowUp`/`ArrowDown` buttons — satisfying the story, matching the
  app's existing interaction model, and keeping the a11y path the drag-only
  version would lose. Trade-off: native HTML5 drag is fiddlier than a library on
  touch devices; the move buttons cover that.
- **Correct `client/messages/en/context.json`, don't just extend it.** It
  predates the spec and encodes two decisions the spec overrules — a `chunks`
  count (Q5 replaces it with a token total) and a `.devdigest/specs/` root (Q4
  replaces it with repo-wide patterns). Root `INSIGHTS.md` (2026-08-23) already
  flags this file as a trap that "may already dictate a shape". Leaving it as-is
  ships copy that contradicts the feature. Trade-off: none that I can see.
- **Consider making `walkClone`'s new options parameter a match predicate rather
  than an extension list.** Q4's roots are patterns, not extensions —
  `**/INSIGHTS.md` is a filename match, not an extension match — and an
  extension-set parameter can't express it without a second filter pass. Trade-off:
  a predicate is slightly less declarative than a `ReadonlySet<string>`; the
  existing `SUPPORTED_SET` default can be expressed as one either way.

## 10. Out of scope / explicitly deferred
- **"COVERAGE" badge and "Used by N agents"** — Q6; deferred together per the
  user's answer. Shipping a number that traces to nothing is the failure mode
  `server/INSIGHTS.md` (2026-08-12) already recorded for skill stats.
- **Any write path into the repo working tree** — `+`, upload, Edit/Save (Q9).
  Needs a threat model and an authorization model that does not exist; the server
  runs `LocalNoAuthProvider`, one seeded user, no login.
- **Embedding / chunking / vector search** — Q5. `code_chunks` keeps its zero
  writers.
- **Repo-scoped agent/skill editor routes** — resolved to (a) this session; the
  editors stay at `/agents/[id]` and `/skills/[id]`.
- **Widening `isAllowedPlanRefShape`** — resolved to (a); the intent layer's
  behavior is untouched.
- **The `memory` prompt slot** — stays unfed.
- **Prompt section reordering** — Q12; the shipped order stands, the screenshot
  is an out-of-date mock.
- **`e2e/`** — no flow is planned here. The feature's browser journey depends on
  a seeded clone with Markdown in it; worth a follow-up once the seed story is
  clear, but adding a flow now would likely be non-hermetic.
- **`mcp-server/`** — unaffected.

## 11. Open questions / risks
- **Historical `specs_read` rows** — see §8. Needs a five-minute check of what is
  actually in `run_traces.trace` on a dev DB (`select trace->'specs_read' from
  run_traces limit 20`), not a guess. Low risk, but it decides whether a tolerant
  read shim is needed in Step 1.
- **Where the `context` module's attachment tables belong** — `server/src/db/schema/`
  has both a `context.ts` (which holds `code_chunks`, an embedding-era table this
  spec explicitly does not touch) and a `knowledge.ts`. Putting Project Context
  attachments in `context.ts` next to a table this feature is defined as *not*
  using invites future confusion. Left as the implementer's call in Step 2 —
  flagging it so the choice is deliberate.
- **`server/INSIGHTS.md` 2026-08-10 contradicts `server/AGENTS.md`** on response
  schemas: the 2026-07-31 decision claims every route declares one, but
  `grep -c "response:" src/modules/*/routes.ts` → 0 everywhere. The new `context`
  module's routes will follow the *actual* pattern (request validation only)
  rather than being the one module that rolls out `schema.response` piecemeal —
  noting both sides rather than silently picking one.
- **The Q8 caps (10 docs / 20 000 chars / ~60 000 chars) are unvalidated
  numbers**, chosen by analogy to `MAX_PLAN_REFS = 5` and
  `MAX_PLAN_EXCERPT_CHARS = 20_000` (`server/src/modules/reviews/intent.ts:32,36`).
  No measurement backs them against a real model's context window. Acceptable for
  v1; put them in `constants.ts` where they are one edit to revise.
- **No external research needed.** Every dependency this plan touches
  (`js-tiktoken`, `react-markdown`, `simple-git`, `drizzle-orm`, Zod, Fastify) is
  already in the repo and already used the way this plan uses it. If that changes,
  route the unknown to the `researcher` subagent rather than guessing.

## 12. Suggested review path (not performed here)
- Before PR: the `pr-self-review` skill, per root `AGENTS.md`. It will map this
  diff to `backend-onion-architecture`, `frontend-architecture`, `zod`, and
  `security` and block on any CRITICAL finding.
- **A dedicated security review is warranted**, not optional: this feature takes
  an attacker-controlled path over HTTP, persists it, reads it back, and feeds a
  filesystem read that has no guard of its own. The two guard points (route
  boundary and pre-`readFile`) and the clone-containment check on symlinked paths
  are the things to audit.
- Architecture sign-off on §5 is worth it for two specific calls: the
  project-context-local allowlist versus widening the shared one, and the
  `walkClone` parameterization versus a fork.
- At the end of the work, record insights per the `engineering-insights` skill —
  the `agent_versions.config_json`-is-untyped-jsonb finding in Step 1 belongs in
  the **root** `INSIGHTS.md` (it sharpens the existing 2026-08-18 entry about
  `.default([])`, so refine that entry rather than appending a near-copy).
