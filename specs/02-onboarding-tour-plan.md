# Development Plan: SPEC-02 Onboarding Tour

> Produced by the `implementation-planner` subagent against
> `specs/02-onboarding-tour.md` (SPEC-02, `Status: approved`). Execution mode
> **delegated to the planner** by the user and decided here: **single-agent**.
> This document is a plan, not a specification — it does not supersede or amend
> SPEC-02.

## 1. Summary

Connect the six already-scaffolded-but-unwired layers of the Onboarding Tour into one working vertical: a per-repo, five-section, LLM-written orientation document grounded strictly in facts `repo-intel` already computed, cached in the existing `onboarding` table, regenerated on demand through a background job that returns 202 immediately, and served at a new `/repos/:repoId/onboarding` route that does not collide with the existing add-repo wizard at `/onboarding`. This is the **third** instance of the "scaffolded across N layers, connected at none" pattern recorded in root `INSIGHTS.md` (2026-08-12, extended 2026-08-23) — like Skills and Project Context before it, the work is mostly wiring plus a small number of new files, not invention.

## 2. Requirements reviewed

- **Supplied:** `specs/02-onboarding-tour.md` read in full. All 13 substantive open questions are marked RESOLVED 2026-08-23; item 14 is informational. Acceptance criteria, edge cases and Non-functional requirements are treated as binding and are **not** re-derived below.
- **`<module>/specs/` search:** `server/specs/` and `client/specs/` hold only a `README.md`. No module-level spec exists for this feature. `specs/README.md` confirms `approved` = agreed to build, and confirms the spec template — it defines no plan template, so this plan follows `specs/01-project-context-plan.md`'s established shape.
- **Execution mode:** not confirmed with the user (explicitly delegated). Decided in §6.

**Gaps found while grounding the spec against this checkout.** None of these change a resolved decision; two are things the spec asserts that the code does not currently support, and one is an AC whose precondition does not exist yet.

1. **`INJECTION_GUARD` is not exported.** SPEC-02's Prompt-ownership paragraph says "`wrapUntrusted` is already re-exported through `server/src/platform/prompt.ts`, so this is a shared helper" and Q9 resolves to "append the shared `INJECTION_GUARD` constant at assembly time." `wrapUntrusted` is indeed exported (`reviewer-core/src/index.ts:15-20` → `server/src/platform/prompt.ts:6-11`). `INJECTION_GUARD` is **not** — it is a module-local `const` at `reviewer-core/src/prompt.ts:16`, consumed only by `assemblePrompt` at `:94`. Honouring Q9 therefore requires a **`reviewer-core/` change**, and `reviewer-core` is not in SPEC-02's `Packages touched:` header. Planned as Step 2 (additive `export` keyword + barrel line; zero behavior change). **Flagged, not resolved silently** — see §11.
2. **The "indexed file set" excludes every manifest file.** See §9 Recommendation 1 — the link filter as literally worded would delete every link the `local_setup` section is supposed to carry.
3. **No workspace locale exists.** See §9 Recommendation 3 — the `{{language}}` AC is a `WHERE (ДЕ)` optional-feature trigger over a feature this codebase does not have.

## 3. Context reviewed

- `specs/02-onboarding-tour.md` — the approved requirement. Its "Non-functional requirements" section is effectively a pre-written constraints list and is reproduced in §5.
- `server/specs/README.md`, `client/specs/README.md` — no per-module spec for this feature. `specs/README.md` — spec template + status vocabulary.
- Root `INSIGHTS.md` — **highly relevant.** 2026-08-12 Codebase Patterns (the N-layers-scaffolded-nothing-connected pattern; SPEC-02 is instance three and cites it itself); **2026-08-04** (`server/src/vendor/shared` and `client/src/vendor/shared` are two independent copies, nothing fails loudly on drift, diff the specific file rather than syncing wholesale); **2026-08-18/2026-08-23** (a `jsonb` column with no `.$type<>()` annotation gives the compiler nothing to check a hand-built literal against — a green `pnpm typecheck` is not evidence).
- `server/INSIGHTS.md` — relevant: **2026-08-23** (`getCriticalPaths` returns dependency *chains*, `string[][]`, seeded from 5 roots — not a flat list of annotated files; surfaced writing this very spec, Q13); **2026-08-13** ×2 (conventions resolves its model through `resolveFeatureModel`, and the `triggerExtraction`/`runExtraction` shape this feature mirrors); **2026-08-18** (`GitClient.readFile` has no traversal guard; reuse `isWithinClone`, refined 2026-08-23 to "reuse `isWithinClone`, not `isAllowedPlanRefShape`"); **2026-08-18 What-Doesn't-Work** (a `.it.test.ts` that mocks only `llm.openai` is not hermetic when the feature resolves to `openrouter` — directly applies here, see §5); **2026-08-10** (no route declares a `response:` schema today, despite the 2026-07-31 decision claiming otherwise).
- `client/INSIGHTS.md` — **two entries written specifically while speccing this feature**: **2026-08-23** (`nav.ts` has no composition seam; editing it directly is the settled convention — a real seam costs *three* vendored files, more surface, not less) and **2026-08-23** (`activeKeyFor`'s `pathname.includes("/onboarding")` already resolves the add-repo wizard to the `onboarding-tour` key — needs a `startsWith("/repos/")` guard the moment a real nav item uses that key). Also relevant: 2026-08-10 (any file importing `@devdigest/ui` MUST be `"use client"`), 2026-08-17 (`@testing-library/user-event` is not a dependency — use `fireEvent`), 2026-08-17 (`src/lib/api.ts` never grows per-endpoint wrappers), 2026-08-12 (`messages/en/<ns>.json` can already dictate a shape).
- `reviewer-core/INSIGHTS.md` — read; nothing on prompt-constant exports or onboarding. This feature adds no engine behavior.
- `AGENTS.md` conventions relevant here: contracts change in `@devdigest/shared` first, then consumers; one feature = one `src/modules/<name>/` plugin registered in `src/modules/index.ts`; routes use `fastify-type-provider-zod`, never hand-rolled `Schema.parse`; `*.it.test.ts` are DB-backed, everything else hermetic; `server/clones/**` excluded from every search; `reviewer-core`'s build is a typecheck and it never touches the filesystem.

**Existing patterns to reuse (cited, verified in this checkout):**

- `server/src/modules/conventions/{routes,service,repository,prompt,constants,helpers}.ts` — the **complete template** for this module. `routes.ts:24` registers the job handler at boot; `service.ts:64-77` is `triggerExtraction`'s 202-with-`degraded` shape; `:80-85` is `registerExtractionJobHandler`; `:88-89` is the `clonePath` guard; `:105-113` is `resolveFeatureModel` → `completeStructured`; `repository.ts:125-137` is `getScanStatus` (derive status from the newest job row — there is no status column).
- `server/src/modules/repo-intel/service.ts:509-513` — `getFileRank(repoId, paths)` → `FileRankRow[]`, backed by `repository.ts:481-487`'s `inArray(fileRank.filePath, paths)`. This is the natural mechanical gate for `links[].path` validation.
- `server/src/modules/repo-intel/service.ts:730-795` — `getTopFilesByRank` (over-fetches 10×, filters junk) and `getCriticalPaths` (chains from `CRITICAL_PATH_ROOTS = 5`).
- `server/src/platform/prompts.ts:40` — `renderPrompt(name, vars)`; `:12-14` notes a production build must copy `src/prompts` → `dist/prompts` (already true today, no change needed).
- `server/src/modules/_shared/schemas.ts:11` — `IdParams`, reused verbatim by both routes per SPEC-02.
- `server/src/adapters/mocks.ts:54,92` — `MockLLMProvider.structuredBySchema` is keyed by `req.schemaName`.
- `server/src/db/rows.ts:19` — `ConventionRow = typeof t.conventions.$inferSelect`; `OnboardingRow` needs the same one-liner (does not exist yet).
- `client/src/lib/hooks/conventions.ts` — the exact hook shape SPEC-02 says to mirror (`refetchInterval` gated on a `poll` flag, `invalidateQueries` on mutation success).
- `client/src/components/safe-markdown/SafeMarkdown.tsx` — already exactly the required renderer: `react-markdown` with **no `rehype-raw`** (raw HTML disabled at the renderer, not post-stripped) plus an `isSafeHref` protocol allowlist. Built for SPEC-01, reusable as-is.
- `client/src/components/mermaid-diagram/MermaidDiagram.tsx:29,39-44,59` — validates with `mermaid.parse({suppressErrors})` under `securityLevel: "strict"` and **returns `null`** on invalid input. This already implements SPEC-02's "drop the diagram silently, render the body without it" AC with zero changes.
- `client/src/lib/vcs-urls.ts:40-62` — `vcsBlobUrl(fullName, sha, file, provider, host)`; a branch name is accepted where `sha` goes, and `Repo` (`contracts/platform.ts:150-165`) carries `full_name`/`default_branch`/`provider`/`host`. Q7's "Open" button needs **no new helper**.
- `client/src/app/repos/[repoId]/conventions/_components/ConventionsListView/helpers.ts:8-16` — `relativeTime()` for the header's "generated 2h ago", with a colocated `helpers.test.ts:26-31`.
- `server/src/db/migrations/0000_init.sql:205,385` — the `onboarding` table and its `ON DELETE cascade` FK already exist. **No migration is needed by this plan.**

## 4. Modules affected

| Module | Package manager | Why touched |
|---|---|---|
| `server/src/vendor/shared` (`@devdigest/shared`) | pnpm (via `server/`) | `OnboardingSection.kind` narrowed to an enum; new `OnboardingStatus`, `OnboardingState`, `OnboardingGenerateAccepted` |
| `client/src/vendor/shared` | pnpm (via `client/`) | Independent second copy of the above — hand-copied (root `INSIGHTS.md`, 2026-08-04) |
| `reviewer-core/` | **npm** | **Two additive lines**: `export` on the existing `INJECTION_GUARD` const + one barrel entry. No behavior change; its `build` stays a typecheck. Required by Q9 and outside SPEC-02's stated package list — see §11. |
| `server/` | pnpm | New `src/modules/onboarding/` plugin (6 files) + registration; `onboarding.system.md` edits (Q1, Q9); one `rows.ts` line; one `schema/context.ts` `.$type<>()` annotation; `platform/prompt.ts` re-export |
| `client/` | pnpm | New `/repos/[repoId]/onboarding` route + view, new `lib/hooks/onboarding.ts`, rewritten `messages/en/onboarding.json`, `nav.ts` item, `activeKeyFor` guard |
| `e2e/` | npm | **No changes.** Listed to make the zero explicit — no seeded browser flow covers this route, and adding one is out of scope (§10). |

## 5. Architectural constraints

- **Contracts first, in both copies.** `server/src/vendor/shared/` and `client/src/vendor/shared/` are independent copies; nothing fails loudly when they drift. Diff the specific file before copying; do not sync wholesale (root `INSIGHTS.md`, 2026-08-04).
- **Onion layering, all three files from day one.** `routes.ts` → `service.ts` → `repository.ts`. `routes.ts` must not import `drizzle-orm` or touch `container.db`; `service.ts` must not import anything from `fastify`. `settings`/`polling`/`pulls`/`workspace` are the four flat modules that are debt, not the pattern — copy `conventions`, not them.
- **Routes declare Zod schemas from `@devdigest/shared` via `fastify-type-provider-zod`.** Never hand-roll `Schema.parse(req.body)`. Note the honest state of the art: `server/INSIGHTS.md` (2026-08-10) records that **no** route declares `response:` today. Match `conventions/routes.ts` (params only, typed return) rather than starting a one-route `response:` precedent here.
- **The `Onboarding` contract cannot be the `completeStructured` schema verbatim.** This is the plan's single most load-bearing design call, and it is forced by the ACs themselves:
  - "*IF the model returns a section whose `kind` is outside that five-value set, THEN discard that section rather than persist it*" and "*IF the model returns fewer than five sections, THEN persist the sections it did return*" both require **per-section** salvage. A strict `z.enum` on the structured-output schema fails the **whole** parse, discarding all five sections, not one.
  - "*persist at most 4 links per section*" is likewise a truncation requirement, not a rejection requirement.
  - Therefore: a **permissive generation schema** local to `server/src/modules/onboarding/prompt.ts` (mirroring `ConventionExtractionSchema` in `conventions/prompt.ts:24-26`) at the LLM boundary; a **normalization pass** in the service that drops bad `kind`s, caps links at 4, and drops unindexed paths; then a **strict `Onboarding.parse()`** immediately before persisting. The narrowed enum in `@devdigest/shared` is the *persistence* gate SPEC-02 asks for ("`kind` must be validated against the fixed enum **before the section is persisted**") — placing it at the LLM boundary instead would violate the discard-one-section AC.
- **All external I/O through the DI container.** LLM via `container.llm(provider)` after `resolveFeatureModel(container, workspaceId, 'onboarding')`; facts via `container.repoIntel.*`. Never re-index — SPEC-02 and `repo-intel/README.md` both make this feature a pure reader.
- **Untrusted-in / untrusted-out, both directions.**
  - *In:* every fact block assembled from repo content wrapped in `wrapUntrusted(label, content)`, and the shared `INJECTION_GUARD` appended to the rendered system prompt (Q9 — one guard, not two).
  - *Out:* `body` through `SafeMarkdown` (raw HTML disabled at the renderer); `diagram` through `MermaidDiagram` (`securityLevel: "strict"`, `parse` before `render`, `null` on failure); `links[].path` filtered against a server-derived path set before persisting; `kind` enum-validated before persisting.
- **Manifest reads use a containment guard.** `server/INSIGHTS.md` (2026-08-18, refined 2026-08-23) — `readFile` has no traversal guard. The manifest paths here are *server constants*, not model output, so the risk is low, but compose the exported `isWithinClone` from `reviews/intent.ts` rather than a bare `join(clonePath, p)`. Do **not** reuse or widen `isAllowedPlanRefShape` — that allowlist belongs to a different feature.
- **`onboarding` has no `workspace_id` column** (`db/schema/context.ts:120-126`), unlike `conventions`. Every read and write must scope through `repos` (workspace-check the repo first, exactly as `ConventionsRepository.getRepo` does). The repository cannot filter on `onboarding.workspaceId` — it does not exist.
- **Overwrite, not version** (Q4). `repoId` is the PK, so the write is `.onConflictDoUpdate({ target: t.onboarding.repoId, set: { json: ..., generatedAt: ... } })`. The FK cascades on repo delete, so the job's write must tolerate the parent row being gone (edge case: repo deleted mid-job).
- **Tests: the `openrouter` trap.** `onboarding`'s `FEATURE_MODELS` default is `openrouter/deepseek-v4-flash` (`contracts/platform.ts:46-51`). Per `server/INSIGHTS.md` (2026-08-18), an `.it.test.ts` that overrides only `llm.openai` is **not hermetic** on a machine with a real `OPENROUTER_API_KEY`. Any integration test here must register a `MockLLMProvider('openrouter', { structuredBySchema: { OnboardingTour: {...} } })`.
- **Client:** all data access through `src/lib/hooks/onboarding.ts` → `src/lib/api.ts` (do not add a named wrapper to `api.ts`); server state in TanStack Query, never mirrored into `useState`; every string through `next-intl`; any file importing `@devdigest/ui` is `"use client"`.

## 6. Execution mode

- **Decided by the planner (delegated by the user): single-agent.**
- **Rationale, from the actual dependency shape.** This spec is one vertical feature whose graph is a near-linear chain, not a fan-out. Step 1 (contracts) gates literally every other step; Step 3 (the server module) gates nothing on the client that isn't already gated by Step 1, but Step 6 (the page) gates on Step 5 (hooks + i18n), and Steps 5-7 all edit the same feature's copy and nav surface. The only genuinely parallel lane after Step 1 is `{2,3}` against `{5,6,7}` — two lanes, one of which is 60% of the work. Against that thin gain sits a concrete, repo-documented drift cost: the two vendored `@devdigest/shared` copies must stay byte-compatible (root `INSIGHTS.md`, 2026-08-04, "nothing fails loudly when they drift"), and the `kind` enum name chosen in Step 1 is referenced by name in Steps 3, 5 and 6. A single sequential pass keeps that naming decision in one head.
- Owned paths below are still kept **disjoint anyway**, so the plan stays re-parallelizable if someone later chooses to split the two lanes. Where order matters beyond path overlap, it is stated as "Depends on".

## 7. Steps

### Step 1: Contracts — `OnboardingState`, `OnboardingGenerateAccepted`, narrowed `kind`

- **Type:** cross-cutting
- **Module/package:** `server/src/vendor/shared` + `client/src/vendor/shared` (pnpm)
- **Owned paths (exclusive to this step):** modified: `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/knowledge.ts`
- **What changes:** In the `// ---- Onboarding ----` block (`knowledge.ts:29-48`):
  - Add `OnboardingSectionKind = z.enum(['architecture','critical_paths','local_setup','reading_path','first_tasks'])` (Q1/Q2/Q3) and narrow `OnboardingSection.kind` to it. Leave `links` as an uncapped array — the 4-link cap is a service-side truncation, not a schema rejection (§5).
  - Add `OnboardingStatus`. Proposed members, **derived from the ACs rather than dictated by them** (see §11): `'empty' | 'generating' | 'ready' | 'partial' | 'failed' | 'not_indexed'`, with documented precedence `not_indexed > generating > partial > ready > failed > empty`.
  - Add `OnboardingState` mirroring `ConventionsState` (`knowledge.ts:222-229`): the cached `Onboarding` (nullable), the status, a nullable `generated_at` ISO string, and `files_indexed: z.number().int()`.
  - Add `OnboardingGenerateAccepted` mirroring `ConventionsExtractAccepted` (`:232-237`): `{ status: z.literal('accepted'), job_id: z.string().nullish(), degraded: z.boolean().optional() }`.
  - Copy the same block by hand into the client's file. Diff first — do not sync the whole file.
- **Skills the implementer will apply:** `zod`, `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** none
- **Tests to run/add:** `cd server && pnpm exec vitest run test/contracts.test.ts` and `pnpm typecheck`; `cd client && pnpm typecheck`. New test in `server/test/contracts.test.ts`: `OnboardingSection` rejects an out-of-enum `kind`, and `OnboardingState` round-trips a null tour.
- **Done means:** both packages typecheck, and a contracts test proves a hallucinated `kind` is rejected by the persistence schema.

### Step 2: Export `INJECTION_GUARD` from `reviewer-core` and re-export it server-side

- **Type:** core
- **Module/package:** `reviewer-core/` (**npm**) + `server/` (pnpm)
- **Owned paths (exclusive to this step):** modified: `reviewer-core/src/prompt.ts`, `reviewer-core/src/index.ts`, `server/src/platform/prompt.ts`
- **What changes:** Add `export` to the existing `const INJECTION_GUARD` at `reviewer-core/src/prompt.ts:16` (its use by `assemblePrompt` at `:94` is untouched — this is purely a visibility change), add it to the barrel's prompt-assembly export block at `index.ts:15-20`, and add it to the re-export shim at `server/src/platform/prompt.ts:6-11`. This is what makes Q9's "one guard, not two" physically possible; without it the only ways to honour Q9 are to duplicate the constant (exactly what Q9 rejects) or to leave the weaker inline paragraph in place (what Q9 deletes).
- **Skills the implementer will apply:** `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** none (parallel-safe with Step 1)
- **Tests to run/add:** `cd reviewer-core && npm run typecheck && npm test`; `cd server && pnpm typecheck`. No new test — an export-visibility change with an existing consumer.
- **Done means:** `import { INJECTION_GUARD } from '../../platform/prompt.js'` typechecks from a server module, and `reviewer-core`'s existing prompt tests are unchanged and green.

### Step 3: The `server/src/modules/onboarding/` plugin, end to end

- **Type:** backend
- **Module/package:** `server/` (pnpm)
- **Owned paths (exclusive to this step):** new: `server/src/modules/onboarding/{routes,service,repository,prompt,constants,helpers}.ts`, `server/test/onboarding-normalize.test.ts`, `server/test/onboarding.it.test.ts`; modified: `server/src/modules/index.ts`, `server/src/prompts/onboarding.system.md`, `server/src/db/rows.ts`, `server/src/db/schema/context.ts`
- **What changes:**
  - **`constants.ts`** — `ONBOARDING_GENERATE_JOB_KIND = 'onboarding-generate'`; `ONBOARDING_SCHEMA_NAME = 'OnboardingTour'` (the `structuredBySchema` key); `ONBOARDING_SECTIONS` (the five canonical keys with their human titles, rendered into `{{sections}}`; the server constant Q3 calls for); `REPO_MAP_TOKEN_BUDGET` (Q12 — reuse the existing mechanism, pick the number here, not in the spec); `TOP_FILES_N`; `MAX_LINKS_PER_SECTION = 4`; `MAX_MANIFEST_CHARS`; `MANIFEST_PATHS` (Q8 — `package.json`, `docker-compose.yml`, `.env.example`, and the obvious siblings).
  - **`prompt.ts`** — the **permissive** generation schema (`kind: z.string()`, uncapped `links`), plus `buildOnboardingPrompt(...)` returning `ChatMessage[]`: system = `await renderPrompt('onboarding.system.md', { sections, language })` **+ `INJECTION_GUARD`** appended; user = fact blocks, each individually `wrapUntrusted`-fenced with a distinct label (`critical-paths`, `ranked-files`, `repo-map`, `manifest:<path>`).
  - **`repository.ts`** — `getRepo(workspaceId, repoId)` (workspace scoping through `repos`, copying `ConventionsRepository.getRepo`); `get(repoId)`; `upsert(repoId, tour, generatedAt)` via `.onConflictDoUpdate({ target: t.onboarding.repoId })`, tolerating a vanished parent row; `getJobStatus(workspaceId, repoId)` modelled on `getScanStatus` (`repository.ts:125-137`) — see §11 for its known window limitation.
  - **`service.ts`** — `getState()` (repo tour + derived status + `repoIntel.getIndexState(repoId).filesIndexed`); `triggerGeneration()` returning `{ jobId, degraded }` with the try/catch-degraded shape of `triggerExtraction` (`service.ts:64-77`), refusing to enqueue when `getIndexState().status === 'failed'` or when `repo.clonePath` is null, and short-circuiting to 202-without-enqueue when a job is already `queued`/`running`; `registerGenerationJobHandler()`; and the private `runGeneration()` — gather facts → `resolveFeatureModel(container, workspaceId, 'onboarding')` → `container.llm(provider).completeStructured({ schemaName: ONBOARDING_SCHEMA_NAME, ... })` → normalize → `Onboarding.parse()` → upsert. A failure anywhere after enqueue leaves the cached row untouched.
  - **`helpers.ts`** — `normalizeTour(raw, allowedPaths)`: drop sections whose `kind` is outside the enum, dedupe by `kind`, order by `ONBOARDING_SECTIONS`, null the `diagram` on every non-`architecture` section, slice `links` to 4, and drop links whose `path` is not in `allowedPaths`. **Pure and exported**, so it is unit-testable without a DB (the `smart-diff` precedent in `server/INSIGHTS.md`, 2026-08-19: put the test where the logic actually lives).
  - **`routes.ts`** — `GET /repos/:id/onboarding` → `OnboardingState`; `POST /repos/:id/onboarding/generate` → `reply.code(202)` + `OnboardingGenerateAccepted`. Both `schema: { params: IdParams }`; both resolve `workspaceId` via `getContext(container, req)`. Job handler registered at boot inside the plugin, as `conventions/routes.ts:24` does.
  - **`src/modules/index.ts`** — one import + one registry entry.
  - **`src/prompts/onboarding.system.md`** — delete the inline SECURITY paragraph (`:11-13`, Q9); remove `routes_and_apis` from the diagram-allowlist sentence (`:8`) and delete the `routes_and_apis`-specific formatting bullet (`:22-26`) (Q1); replace the removed formatting guidance with equivalent guidance for the five canonical sections, and add Q13's rule explicitly — *any "used by N" count must come from the provided facts or be omitted; never estimated.*
  - **`src/db/rows.ts`** — add `export type OnboardingRow = typeof t.onboarding.$inferSelect;` next to `ConventionRow` (`:19`).
  - **`src/db/schema/context.ts:124`** — annotate the column `jsonb('json').$type<Onboarding>().notNull()`. Type-only, **no migration**; closes the exact trap root `INSIGHTS.md` (2026-08-23) records for `agent_versions.config_json`.
- **Skills the implementer will apply:** `backend-onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `zod`, `security`, `typescript-expert`, `engineering-insights`
- **Depends on:** Step 1 (contract names), Step 2 (`INJECTION_GUARD` import)
- **Tests to run/add:**
  - New hermetic `server/test/onboarding-normalize.test.ts` — bad `kind` discarded while the other sections survive; 4 sections persisted as-is; 6 links truncated to 4; an unindexed `links[].path` dropped; a `diagram` on a non-`architecture` section nulled.
  - New `server/test/onboarding.it.test.ts` — `GET` on a repo with no row returns the empty state; `POST` returns **202** and `GET` then reports `generating`; a second `POST` while running does not enqueue a second job; after the job runs, `GET` returns the cached tour with no further LLM call. **Must register a `MockLLMProvider('openrouter', { structuredBySchema: { OnboardingTour: {...} } })`** (§5).
  - Run: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` then `pnpm exec vitest run .it.test`, plus `pnpm typecheck`.
- **Done means:** against a booted API, `POST /repos/:id/onboarding/generate` returns 202 before the LLM call finishes, and a subsequent `GET /repos/:id/onboarding` transitions `generating` → `ready` with five persisted sections and no invented file paths.

### Step 4: Client data layer — `hooks/onboarding.ts`

- **Type:** ui
- **Module/package:** `client/` (pnpm)
- **Owned paths (exclusive to this step):** new: `client/src/lib/hooks/onboarding.ts`; modified: `client/src/lib/hooks/index.ts`
- **What changes:** `useOnboardingState(repoId, poll)` → `api.get<OnboardingState>('/repos/${repoId}/onboarding')` with `refetchInterval: poll ? 2000 : false` and `enabled: !!repoId`; `useGenerateOnboarding(repoId)` → `api.post(...)` with `invalidateQueries({ queryKey: ['onboarding', repoId] })` on success. Mirrors `hooks/conventions.ts` line for line. One barrel line in `hooks/index.ts`. **No** new named export in `src/lib/api.ts` (`client/INSIGHTS.md`, 2026-08-17).
- **Skills the implementer will apply:** `frontend-architecture`, `next-best-practices`, `react-best-practices`, `security`, `typescript-expert`, `engineering-insights`
- **Depends on:** Step 1 (the client's vendored `OnboardingState`)
- **Tests to run/add:** `cd client && pnpm typecheck`. No dedicated hook test — this repo tests hooks through the component that uses them (Step 5), matching `hooks/conventions.ts`, which has none.
- **Done means:** the page in Step 5 can consume typed state and a mutation without any component calling `fetch`.

### Step 5: The Onboarding Tour page

- **Type:** ui
- **Module/package:** `client/` (pnpm)
- **Owned paths (exclusive to this step):** new: `client/src/app/repos/[repoId]/onboarding/page.tsx`, `client/src/app/repos/[repoId]/onboarding/_components/OnboardingTourView/{OnboardingTourView.tsx,constants.ts,helpers.ts,styles.ts,index.ts,OnboardingTourView.test.tsx}`; modified: `client/messages/en/onboarding.json`
- **What changes:**
  - Thin Server-Component `page.tsx` rendering one `"use client"` view, per `conventions/page.tsx`.
  - `OnboardingTourView` renders: a header with the repo name, `files_indexed`, and `relativeTime(generated_at)`; a **Regenerate** button disabled while `status === 'generating'`; a **Share link** button copying `window.location.href` to the clipboard (Q6); an on-page **rail** listing every section title; and one collapsible card per section — `SafeMarkdown` for `body`, `MermaidDiagram` for `diagram` (only on `architecture`), and per-link **Open** buttons built from `vcsBlobUrl(full_name, default_branch, path, provider, host)` off `useActiveRepo()` (Q7).
  - Distinct states: `empty` → the Generate empty state; `generating` → poll at 2s with the control disabled; `not_indexed` → "repo is not indexed yet"; `partial` → the tour plus a degradation note; `failed` → error state with the previously cached tour still shown if present. `RepoNotFound` for an unknown `repoId`, per `ProjectContextView`.
  - `helpers.ts` gets a local `relativeTime` (copy `ConventionsListView/helpers.ts:8-16` — do **not** promote it to `src/lib/` on the second consumer; `frontend-architecture` says promote on a second *unrelated* need, and these are the same "last refreshed" need).
  - **Rewrite `messages/en/onboarding.json`.** Its `generate.body` at `:10` currently describes the *wrong* five sections (Q1 explicitly requires this line be updated). Add keys for the five section titles, the rail, copy/share/open controls, and the `partial`/`not_indexed`/`failed` states.
- **Skills the implementer will apply:** `frontend-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library`, `security`, `typescript-expert`, `engineering-insights`
- **Depends on:** Step 4
- **Tests to run/add:** New `OnboardingTourView.test.tsx` — three flow tests per `react-testing-library`: (1) cached tour loads → five section titles render in the rail → a header control toggles a section collapsed → the copy control puts a command on the clipboard; (2) empty state → clicking Generate fires the mutation and the control disables; (3) `not_indexed` renders its own message and no Generate control. Use **`fireEvent`**, not `user-event` (`client/INSIGHTS.md`, 2026-08-17). Run `cd client && pnpm test && pnpm typecheck`.
- **Done means:** `/repos/<id>/onboarding` renders a cached tour with a working rail, collapse, copy and Open, and an invalid `diagram` degrades to body-only rather than an error box.

### Step 6: Sidebar placement and the `/onboarding` highlight collision

- **Type:** ui
- **Module/package:** `client/` (pnpm)
- **Owned paths (exclusive to this step):** modified: `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/helpers.ts`
- **What changes:**
  - Add an `{ key: "onboarding-tour", label: "Onboarding Tour", icon: ..., href: "/repos/:repoId/onboarding" }` item to the **WORKSPACE** group (`nav.ts:22-33`), alongside Pull Requests (Q10). Editing the vendored `nav.ts` directly is the settled convention, documented in `client/INSIGHTS.md` (2026-08-23) after the seam was investigated and rejected as *more* vendor surface, not less — this is not a violation to re-litigate.
  - Fix `activeKeyFor` (`app-shell/helpers.ts:29`): `pathname.includes("/onboarding")` currently matches the add-repo wizard at `/onboarding` and returns `onboarding-tour` — harmless only while no nav item uses that key, which this step ends. Guard it to the repo-scoped route (`startsWith("/repos/") && includes("/onboarding")`) so the wizard leaves the item unhighlighted, exactly as the routing AC requires. This exact fix is pre-recorded in `client/INSIGHTS.md` (2026-08-23).
- **Skills the implementer will apply:** `frontend-architecture`, `react-best-practices`, `next-best-practices`, `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** none structurally, but land after Step 5 so the nav item never points at a 404.
- **Tests to run/add:** New unit test for `activeKeyFor` — `/onboarding` → **not** `"onboarding-tour"`; `/repos/abc/onboarding` → `"onboarding-tour"`; `/repos/abc/context` and `/repos/abc/conventions` unchanged. Run `cd client && pnpm test && pnpm typecheck`, then boot `pnpm dev` and hit both `/onboarding` and `/repos/<id>/onboarding` — `client/INSIGHTS.md` (2026-08-10) records that `next build` + tests are **not** sufficient evidence for a Server/Client boundary.
- **Done means:** the item appears under WORKSPACE, highlights on the tour route, and stays unhighlighted on the add-repo wizard.

## 8. Cross-cutting concerns

- **Ordering.** Contracts (Step 1) before every consumer, per root `AGENTS.md`. Step 2 is independent of Step 1 but must precede Step 3. Steps 4 → 5 → 6 in order.
- **No database migration.** The `onboarding` table and its cascading FK already exist (`0000_init.sql:205,385`); Q4's overwrite-in-place is exactly what the `repoId` PK supports. The `.$type<Onboarding>()` annotation in Step 3 is a TypeScript-only change — if `pnpm db:generate` proposes a migration after it, that is a signal something else changed and should be investigated, not committed.
- **No feature flag.** The route is additive and the nav item lands last. `container.config.repoIntelEnabled` is the *de facto* gate: every `repoIntel.*` read returns `[]`/degraded when it is off, so the service must render the not-indexed state rather than generate an ungrounded tour.
- **Two guards must not drift.** Step 2's export and Step 3's prompt-file deletion are two halves of one decision (Q9). Landing only one leaves the feature either unguarded or double-guarded. Do not split them across sessions.
- **`messages/en/onboarding.json` is a spec, not dead weight** (`client/INSIGHTS.md`, 2026-08-12) — but in this case it encodes the *superseded* section list, and Q1 explicitly orders it rewritten. It is the one existing i18n namespace in this repo that must be corrected rather than extended.

## 9. Recommendations

1. **Define the link-validation set as a union, not "the indexed file set" literally.** `file_rank` — the table behind `getFileRank` — is populated only from files the walker accepted, and `walkClone` filters to `SUPPORTED_EXT` = `.ts/.tsx/.js/.jsx/.mjs/.cjs` (`repo-intel/pipeline/walk.ts:30,34,127`). So `package.json`, `docker-compose.yml`, `.env.example` and `README.md` are **not** in that set. Q8 resolves that those exact files are fed to the prompt as facts, and the `local_setup` section is the one most likely to link to them — so the filter as literally worded ("*IF a generated `links[].path` is absent from the repo's indexed file set, THEN omit that link*") would silently strip every link that section produces, leaving a visibly broken card. **Recommendation:** the allowed set = `getFileRank(repoId, candidatePaths)` hits **∪** the `MANIFEST_PATHS` that were actually read and fed. Both halves are server-derived and never model-derived, so the anti-hallucination and anti-`javascript:` guarantees are fully preserved; only the definition of "exists" widens to match what was actually shown to the model. **Trade-off:** one extra server-side set to keep in sync with `MANIFEST_PATHS`, and it does not cover a repo whose setup lives in an unlisted file (Makefile, Taskfile) — accepted, matching Q8's already-stated "accept the risk of a confidently wrong command in v1."
2. **Test `normalizeTour` as a pure function, and the routes as `.it.test.ts`, rather than one big integration test.** Grounded in `server/INSIGHTS.md` (2026-08-19): `buildSmartDiff`'s dismissed-finding test was a false test because the filter lived one layer up. Here the inverse holds — the discard/truncate/filter ACs are the *only* place per-section salvage happens, and they are pure. **Trade-off:** two test files instead of one; the payoff is that the five structural ACs get fast, hermetic, LLM-free coverage. Already reflected in Step 3.
3. **Pass a server constant for `{{language}}` in v1, behind a one-function seam.** The `{{language}}` AC is a `WHERE (ДЕ)` optional-feature trigger, and the feature it is conditional on does not exist: `SettingsKnown` (`contracts/platform.ts:96-104`) has no locale key, and `client/src/i18n/request.ts:14` hardcodes `LOCALE = "en"` with a comment stating "single locale `en`, no locale routing." **Recommendation:** a `resolveLanguage(container, workspaceId)` helper that returns `'English'` today, so the day a locale setting lands there is exactly one line to change and no prompt-assembly rework. Do **not** add a locale setting as part of this feature — that is a separate spec. **Trade-off:** a function with one hardcoded return is mild over-engineering; the alternative is inlining `'English'` in `buildOnboardingPrompt` and re-threading it later. Either is defensible; flagging so the choice is conscious.

## 10. Out of scope / explicitly deferred

- Everything in SPEC-02's own Non-goals: chat/Q&A over the tour, an accept/reject/edit loop, per-user progress, re-indexing, absorbing Project Context, and any change to the auth or sharing model.
- Everything the 13 resolved questions explicitly declined for v1: version history and a `(repo_id, generated_at)` migration (Q4); file-card / difficulty-hinted / real-issue-linked "First tasks" (Q5); a genuine unauthenticated public share link and Markdown export (Q6); an in-app file viewer (Q7); a command verifier (Q8); a per-repo section configuration UI (Q3); automatic/push-triggered regeneration (Q11); raw-chain UI and a reverse-dependency facade method (Q13).
- **An `e2e/` flow.** Existing flows are hermetic and seeded; a tour requires either a persisted fixture row or an LLM call. Deferred to its own task.
- **Rolling out `schema.response`** on these two routes. `server/INSIGHTS.md` (2026-08-10) records that no route does this today and that it is real, audited work; starting on two new routes would create an inconsistent precedent mid-feature.
- **Reconciling the nav-grouping inconsistency with SPEC-01**, which put Project Context under WORKSPACE while this spec puts the tour there too but SKILLS LAB holds Conventions. SPEC-02 Q10 notes this explicitly as "noted, not reconciled here."

## 11. Open questions / risks

- **`reviewer-core` is not in SPEC-02's `Packages touched:` header, but Q9 requires a change there.** `INJECTION_GUARD` is module-local (`reviewer-core/src/prompt.ts:16`) and not exported (`index.ts:15-20`). The change is two additive lines with no behavior change, but it widens the spec's stated blast radius. **Needs a one-line confirmation from the spec owner** that adding an export to `reviewer-core` is acceptable, or an instruction to fall back to a server-local copy of the guard text — which would reintroduce exactly the two-copies drift Q9 rejected. Step 2 assumes the former.
- **`OnboardingStatus`'s exact members and their precedence are derived, not dictated.** The ACs name `generating` and `partial` and describe an empty state and a not-indexed state, but never enumerate the enum or say what wins when a repo is both `partial` and mid-regeneration. Step 1's proposal (`not_indexed > generating > partial > ready > failed > empty`) is the reading that satisfies every stated AC, but a spec owner may want a different precedence. Low risk — a single ordered `if` chain in `service.getState`.
- **`getScanStatus`'s 20-row window is a known, inherited limitation.** `ConventionsRepository.getScanStatus` (`repository.ts:125-137`) fetches the newest 20 jobs of a kind **per workspace**, then filters by `repoId` in JS. On a workspace where 20+ onboarding jobs were enqueued across other repos since this repo's last one, that repo's job falls outside the window and reads as `idle` — the UI would stop polling early and show a stale tour. Copying the pattern keeps consistency; a `repoId`-indexed query would fix it but means either a jsonb path operator (which the existing comment explicitly avoids) or a status column (a migration). **Recommend copying as-is and recording this in `server/INSIGHTS.md`** rather than diverging mid-feature.
- **`getCriticalPaths` returns chains, the UI wants annotated files.** Already resolved by Q13 (mechanical selection + LLM narration), but the shape mismatch is real and pre-recorded in `server/INSIGHTS.md` (2026-08-23). The risk is that an implementer reads `string[][]` and quietly reshapes it. The prompt must receive chains *as chains* and the model must narrate over them; any "used by N" figure must be omitted rather than estimated.
- **No external research needed.** Every library involved (`react-markdown`, `mermaid`, `drizzle`, `zod`, `fastify-type-provider-zod`) is already in use in this repo with a working call site cited above. Nothing here should go to the `researcher` agent.
- **Verification gap to respect:** `client/INSIGHTS.md` (2026-08-10) — `next build` + a green vitest suite is *not* evidence a Server/Client boundary is safe. Step 6's done-condition requires actually booting `pnpm dev` and hitting both routes.

## 12. Suggested review path (not performed here)

- Before PR: the `pr-self-review` skill, per root `AGENTS.md`. It will map this diff onto `backend-onion-architecture`, `frontend-architecture`, `zod` and `security` and block on any CRITICAL finding.
- **A dedicated security review is warranted.** Two distinct untrusted surfaces (repo content into the prompt; LLM output back into Markdown, mermaid and an `href`) plus a filesystem read from a cloned user repo. Worth a targeted pass over `normalizeTour`, the `wrapUntrusted` fencing, and the manifest-read containment guard specifically.
- **Architecture sign-off recommended on one point:** the permissive-generation-schema / strict-persistence-schema split in §5. It is forced by the ACs, but it means the shared `Onboarding` contract is deliberately *not* the `completeStructured` schema — a divergence from the `ConventionExtractionSchema` precedent that a reviewer will notice and should be told about rather than discover.

---

**Files most relevant to whoever picks this up:**
`/Users/o.ivashkov/projects/private/dev-digest/specs/02-onboarding-tour.md` ·
`/Users/o.ivashkov/projects/private/dev-digest/server/src/modules/conventions/service.ts` (the template) ·
`/Users/o.ivashkov/projects/private/dev-digest/reviewer-core/src/prompt.ts` (line 16, the unexported guard) ·
`/Users/o.ivashkov/projects/private/dev-digest/server/src/modules/repo-intel/pipeline/walk.ts` (line 30, why manifests aren't "indexed") ·
`/Users/o.ivashkov/projects/private/dev-digest/client/src/components/app-shell/helpers.ts` (line 29, the highlight collision)
</content>
</invoke>
