# Development Plan: SPEC-03 PR Why + Risk Brief

## 1. Summary
Add a one-glance "what changed, why, how risky, what to read first" card to the
PR Overview tab. One structured LLM call over already-computed signals (intent,
blast radius, diff stats, linked ticket, plan/spec excerpts — never diff hunk
bodies) produces `{what, why, risks[], review_focus[]}`; a mechanical grounding
gate drops every item citing a file/endpoint that isn't real; `risk_level` is
computed server-side as the max severity of the surviving risks; the result is
persisted to the already-existing, so-far-unused `pr_brief` table with the PR's
`headSha` embedded, served by `GET /pulls/:id/brief` (compute-if-missing) and
regenerable via a rate-limited `POST /pulls/:id/brief/refresh`. The client gets
a new `PrBriefCard` with a risk badge, a staleness hint, and a clickable
`review_focus[]` list that jumps to the Files-changed tab and scrolls to the
cited file/line.

## 2. Requirements reviewed
- **Supplied:** `/Users/o.ivashkov/projects/private/dev-digest/specs/03-pr-why-risk-brief.md`
  (SPEC-03, Status: approved, 24 EARS acceptance criteria, all 7 Open Questions
  decided 2026-08-24). No `server/specs/`, `client/specs/` or
  `reviewer-core/specs/` content exists beyond a `README.md` in each — the
  root `specs/` folder is where this repo's approved specs live.
- **Ambiguities found and resolved this round (3):**
  1. **Contradiction between OQ5's decision and AC1/AC21.** The decision says
     `PrBriefCard` renders "above `VerdictBanner`", but `VerdictBanner`'s only
     render site is inside `ReviewRunAccordion.tsx:149` — i.e. per-review-run in
     the **Findings** tab — while AC1 and AC21 anchor the card to the **Overview**
     tab and to `IntentCard`'s mount-triggers-compute pattern.
     **Resolved:** product owner accepted rendering `PrBriefCard` as the first
     card in `OverviewTab`, above `IntentCard`; `VerdictBanner` and
     `ReviewRunAccordion` stay untouched. "Above `VerdictBanner`" is treated as
     a screenshot-ordering artifact.
  2. **`review_focus[]` has no defined shape** — the spec references
     `review_focus[].file`, "line, when present" (AC23) and implies an
     endpoint/cron reference (AC12), but never declares the type, and unlike
     `risks[]` there is no existing contract to reuse.
     **Resolved:** `ReviewFocusItem { file: string; line?: number;
     endpoint?: string; reason: string }`, grounded as file ∈ full changed-file
     set, endpoint ∈ `impacted_endpoints ∪ impacted_crons`, else drop the item
     whole.
  3. **Execution mode** — not stated in the request.
     **Resolved:** multi-agent (see §6).
- **Not re-litigated:** all 7 Open Questions' 2026-08-24 decisions are taken as
  given, per the task instruction.

## 3. Context reviewed
- `specs/03-pr-why-risk-brief.md` — the spec itself; the only `specs/` file
  relevant. `server/specs/README.md`, `client/specs/README.md` — placeholders,
  no feature specs.
- `server/docs/`, `client/docs/`, `reviewer-core/docs/` — each contains only a
  `README.md`; **no per-feature docs found.** The real design docs for the
  features this one mirrors live at `docs/plans/intent-layer.md`,
  `docs/plans/intent-scope-drift.md`, `docs/plans/blast-radius.md`,
  `docs/plans/smart-diff.md` (referenced throughout the source comments cited
  below).
- `INSIGHTS.md` (root) — **2026-08-04:** `server/src/vendor/shared` and
  `client/src/vendor/shared` are two independent hand-copied trees; editing one
  does not update the other and nothing fails loudly on drift. **2026-08-24:**
  already records that `pr_brief` + `risk_brief` are pre-existing unused
  scaffolding and that `PrBrief` in `brief.ts` is a false match — matching the
  spec's OQ1 decision. **2026-08-18:** adding a `.default([])` field to a Zod
  contract breaks every hand-built object literal typed as that schema.
- `server/INSIGHTS.md` — **2026-08-18:** `GitClient.readFile` has no traversal
  guard; every caller must guard. **Refined 2026-08-23:** reuse `isWithinClone`
  freely, but only reuse `isAllowedPlanRefShape` if the new feature's accepted
  path shapes are *genuinely identical* to intent's (they are here — we re-read
  the exact same `Intent.plan_refs`). **2026-08-18:** the `openrouter`-not-mocked
  integration-test flake — does **not** apply here, `risk_brief` defaults to
  provider `openai`. **2026-08-19:** transport-vs-persisted contract split.
  **2026-08-18:** `container.reviewRepo` is the mockable path for a
  `getOrCompute*` helper, unlike `this.repo` construction.
- `client/INSIGHTS.md` — **2026-08-20:** `SmartDiffViewer` already owns a
  `ScrollTarget {path, line, n}` and drives `FileCard`'s `scrollToLine`/
  `scrollNonce`. **2026-08-19:** `diff-viewer/*` has zero dedicated test files
  by convention — coverage comes through `SmartDiffViewer.test.tsx`.
  **2026-08-12:** `messages/en/<ns>.json` may already hold copy for unbuilt UI —
  check before writing new keys (it does here, see below). **2026-08-23:** a
  page-level `VALID_TABS` whitelist can silently snap a new `?tab=` back.
- `reviewer-core/INSIGHTS.md` — **2026-07-31 Decision:** the mechanical
  grounding gate is the package's core principle ("never trust the model's own
  citation"). **2026-08-18:** a new `PromptParts` slot must also be added to
  `PromptAssembly` in `trace.ts` — *not applicable here*, this feature does not
  touch `assemblePrompt`.
- `AGENTS.md` conventions relevant here: contracts change in
  `@devdigest/shared` **first**; `server/`+`client/` are pnpm,
  `reviewer-core/` is npm, never mixed; `*.it.test.ts` = DB-backed, everything
  else hermetic; read `server/README.md` when adding an API route and
  `client/README.md` when adding a data hook; `server/clones/**` excluded from
  all search.
- Existing patterns referenced:
  - `server/src/modules/reviews/intent.ts:348-377` — `getOrComputeIntent`'s
    cache-read → in-flight-dedup → compute shape, to be mirrored exactly.
  - `server/src/modules/reviews/intent.ts:102-115` (`tierFor`) — the
    "deterministic, never a model self-report" precedent for `risk_level`.
  - `server/src/modules/reviews/intent.ts:236-256` — `isAllowedPlanRefShape` /
    `isWithinClone` / `isSafePlanRefPath`, all exported; re-applied per read.
  - `server/src/modules/reviews/intent.ts:325-336` — `buildDiffStatFallback`'s
    file-list-only shape. **Not exported**, and `MAX_DIFF_STAT_FILES:39` is not
    exported either — this feature writes its own copy rather than modifying
    `intent.ts` (keeps Owned paths disjoint).
  - `server/src/modules/reviews/service.ts:212-233` — the workspace-scoped
    lookup + `NotFoundError` + delegate shape for a `getOrCompute*` route.
  - `server/src/modules/reviews/service.ts:279-292` — how `getBlastRadius`
    obtains a `PrBlastRadius` (`container.repoIntel.getBlastRadius` +
    `getIndexState` in parallel → `buildPrBlastRadius`); the risk-brief compute
    reuses this call shape directly rather than depending on `ReviewService`.
  - `server/src/modules/reviews/routes.ts:177-201` — the exact GET/POST-refresh
    pair + `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`.
  - `server/src/modules/reviews/repository/pull.repo.ts:49-92` —
    `upsertIntent`/`getIntent`, the shape for the new `pr_brief` accessors.
  - `server/src/db/schema/reviews.ts:93-97` — `pr_brief { prId, json }`, exists,
    zero writers. `server/src/db/schema/pulls.ts:20` — `headSha`.
  - `reviewer-core/src/review/intent.ts:96-162` — `INTENT_INJECTION_NOTE` +
    `wrapUntrusted` per section + single `completeStructured` call.
  - `reviewer-core/src/grounding.ts:52-90` — `groundFindings`'s drop-not-reject
    + `groundingSummary`'s `"kept/total passed"` log line.
  - `server/src/adapters/mocks.ts:90-106` — `MockLLMProvider.completeStructured`
    resolves fixtures by `structuredBySchema[req.schemaName]`.
  - `client/.../IntentCard/IntentCard.tsx:31-85` — the
    loading/notComputed(404)/error/refresh state machine to mirror verbatim.
  - `client/src/lib/hooks/reviews.ts:98-124` — `usePrIntent`/`useRefreshPrIntent`,
    including `retry: false on 404` and the `setQueryData` + `invalidateQueries`
    refresh pattern.
  - `client/.../SmartDiffViewer/SmartDiffViewer.tsx:28-33,221-224` — the
    `ScrollTarget {path,line,n}` → `FileCard.scrollToLine/scrollNonce` chain
    that the tab-jump reuses instead of inventing a scroll mechanism.
  - `client/.../PrDetailView/PrDetailView.tsx:66-73` — `setParam`/`setTab`, the
    only place tab state is owned.
  - `client/messages/en/brief.json` — **already contains unrendered
    `block.risks`, `noRisks`, `unavailable`, `unavailableHint` keys.** Reuse
    them; do not invent parallel keys (client `INSIGHTS.md` 2026-08-12).

## 4. Modules affected
| Module | Package manager | Why touched |
|---|---|---|
| `server/src/vendor/shared` (`@devdigest/shared`) | n/a (vendored, part of `server/`) | New `contracts/risk-brief.ts` + barrel export — the deliberate contract change that unblocks everything else |
| `client/src/vendor/shared` (`@devdigest/shared`, 2nd copy) | n/a (vendored, part of `client/`) | Same file hand-copied — the two trees are independent (root `INSIGHTS.md` 2026-08-04) |
| `reviewer-core/` | **npm** | The single structured LLM call + the risk-brief grounding gate (pure, injected `LLMProvider` only) |
| `server/` | **pnpm** | `pr_brief` persistence, compute orchestration + signal assembly, `risk_level`, service + 2 routes |
| `client/` | **pnpm** | `usePrBrief`/`useRefreshPrBrief`, new `PrBriefCard`, `OverviewTab` wiring, cross-tab jump, i18n |

## 5. Architectural constraints
- **Contracts first, both copies.** `contracts/risk-brief.ts` + the `index.ts`
  barrel must land in `server/src/vendor/shared` *and* `client/src/vendor/shared`
  in the same step. This is the one sanctioned exception to `AGENTS.md`'s
  `**/src/vendor/**` do-not-touch rule ("a deliberate contract change"). Nothing
  else may edit `vendor/shared`.
- **`brief.ts` is untouched.** `PrBrief`/`Risks`/`PrHistory`/`BlastRadius` stay
  exactly as they are (OQ1). `Risk`/`RiskSeverity` are *imported* from it.
- **Onion layering (`backend-onion-architecture`).** `routes.ts` parses +
  rate-limits + calls one `service.*` method — no `container.db`, no
  `drizzle-orm`. All `pr_brief` SQL lives in `repository/pull.repo.ts`,
  reachable only via `ReviewRepository`. The compute helper
  (`reviews/risk-brief.ts`) is application-layer: it may use `container.*`
  adapters, must not import `fastify`/`FastifyRequest`.
- **`reviewer-core` purity.** No DB, no fs, no network except the injected
  `LLMProvider`. All signal gathering (ticket fetch, plan-file reads, diff-stat
  assembly, blast lookup) happens server-side and arrives as resolved strings —
  exactly as `classifyIntent` requires today.
- **`reviewer-core` emits no JS.** Its `build` is a typecheck; it is consumed as
  TypeScript source. Do not add a compile step.
- **The grounding gate is mandatory and never bypassed.** No `risks[]` or
  `review_focus[]` item reaches persistence or the client before mechanical
  verification against the allowlist (AC11-13).
- **`risk_level` is never in the LLM schema** (AC15). Server-computed only.
- **`INTENT_CLASSIFY_TIMEOUT_MS`-style bounded timeout is mandatory** — the
  provider default is 90s (`reviewer-core/src/llm/openrouter.ts`), which
  `server/INSIGHTS.md` (2026-08-18) already records as the cause of a real test
  flake. Spec proposes 30s for `risk_brief`.
- **Path-traversal guard re-runs per read.** `Intent.plan_refs` stores paths,
  not content; `isSafePlanRefPath(clonePath, path)` must pass before every
  `container.git.readFile`. Diff-stat file paths are prompt strings only and are
  **never** used as a read target — call that out in a comment so no one adds a
  redundant (or, worse, a *missing*) guard later.
- **Untrusted-input wrapping.** Every author/repo-controlled field goes through
  `wrapUntrusted()` under a new, risk-brief-scoped injection note — not a
  verbatim reuse of `INJECTION_GUARD` or `INTENT_INJECTION_NOTE`.
- **Zod drives both directions.** Route `schema: { params, response: { 200 } }`
  from `@devdigest/shared`; no hand-rolled `Schema.parse(req.body)`.
- **Package managers never mixed:** `pnpm` in `server/`/`client/`, `npm` in
  `reviewer-core/`.
- **Do not touch:** `server/clones/**`, `pnpm-lock.yaml`, `package-lock.json`,
  `client/src/vendor/ui/**`, `server/src/vendor/shared/contracts/brief.ts`,
  `.../contracts/why.ts` (unrelated `git-why` feature — no name collisions).

## 6. Execution mode
- **Confirmed with user:** multi-agent
- Owned paths are strictly disjoint across all 8 steps — no file appears in two
  steps. Where sequencing is genuinely required it is expressed as
  "Depends on" instead of shared ownership. Concretely: Step 1 gates everything;
  Steps 2 and 3 are parallel-safe with each other; Steps 6 and 7 are split
  along a file boundary (Step 6 owns `PrBriefCard/` + `OverviewTab.tsx` and
  declares the optional `onOpenFile` prop; Step 7 owns `PrDetailView.tsx` +
  `DiffTab.tsx` + `SmartDiffViewer*` and supplies it) rather than both editing
  `OverviewTab.tsx`.

## 7. Steps

### Step 1: `@devdigest/shared` — `contracts/risk-brief.ts` (both vendored copies)
- **Type:** cross-cutting
- **Module/package:** `server/src/vendor/shared` + `client/src/vendor/shared`
- **Owned paths (exclusive to this step):**
  new: `server/src/vendor/shared/contracts/risk-brief.ts`,
  `client/src/vendor/shared/contracts/risk-brief.ts`;
  modified: `server/src/vendor/shared/index.ts`,
  `client/src/vendor/shared/index.ts`
- **What changes:** A new contracts file declaring, per OQ1's decision and the
  `blast.ts:1-19` precedent (new `Pr`-prefixed types rather than reshaping an
  unused old contract):
  - `ReviewFocusItem` — `{ file, line?, endpoint?, reason }`, the shape agreed
    this round.
  - `RiskBriefExtraction` — the **raw LLM shape**: `what`, `why`, `risks[]`
    (reusing `Risk` imported from `./brief.js`), `review_focus[]`. **No
    `risk_level`** (AC15) and no `confidence`, mirroring how
    `IntentExtraction` deliberately omits `confidence`.
  - `PrRiskBrief` — the persisted/transport shape: `RiskBriefExtraction` plus
    `pr_id`, server-computed `risk_level` (`RiskSeverity`, also imported from
    `./brief.js`), and `head_sha` (the value the brief was computed against,
    per OQ4 — stored inside the `json` blob, no migration).
  - Both files are byte-identical; both barrels gain
    `export * from './contracts/risk-brief.js';`.
  A doc-comment at the top of the file should state why this is a new file and
  not a reshape of `PrBrief`, the way `blast.ts` does.
  **Watch:** if any field uses `.default([])`, `z.infer` still marks it
  *required* on the output type — grep for hand-built literals of the type
  before assuming additive means safe (root `INSIGHTS.md` 2026-08-18). There are
  none yet, so prefer plain `z.array(...)` over `.default([])` here.
- **Skills the implementer will apply:** `zod`, `typescript-expert`,
  `security`, `engineering-insights`
- **Depends on:** none
- **Tests to run/add:** `cd server && pnpm typecheck`; `cd client && pnpm typecheck`.
  New test: `server/test/risk-brief-contract.test.ts` — hermetic, mirroring
  `server/test/blast-contract.test.ts`: asserts `RiskBriefExtraction` **rejects**
  a payload containing `risk_level` in strict terms (or, at minimum, that
  `PrRiskBrief.parse` requires a `risk_level` the extraction schema does not
  supply), and that a round-trip `PrRiskBrief` object parses.
  **Done when:** both packages typecheck and the contract test passes.

### Step 2: `reviewer-core` — the structured risk-brief call + its grounding gate
- **Type:** core (reviewer-core)
- **Module/package:** `reviewer-core/` (**npm**)
- **Owned paths (exclusive to this step):**
  new: `reviewer-core/src/review/risk-brief.ts`,
  `reviewer-core/test/risk-brief.test.ts`;
  modified: `reviewer-core/src/grounding.ts`, `reviewer-core/src/index.ts`
- **What changes:**
  1. `src/review/risk-brief.ts` — `extractRiskBrief(input)`, a sibling to
     `classifyIntent`, structured 1:1 on `review/intent.ts`: an injected `llm` +
     caller-chosen `model` (never hardcoded), pre-resolved string inputs only
     (intent text, blast summary, diff-stat block, ticket, plan excerpts), one
     `llm.completeStructured<RiskBriefExtraction>({ schema:
     RiskBriefExtraction, schemaName: 'RiskBriefExtraction', ... })` call
     (AC9), a retry budget constant, and a forwarded `timeoutMs`. Every
     untrusted section goes through `wrapUntrusted('<tag>', text)`; the system
     prompt carries a **new** `RISK_BRIEF_INJECTION_NOTE` written for this
     prompt's framing (not a copy of `INJECTION_GUARD` or
     `INTENT_INJECTION_NOTE`), and explicitly instructs the model not to emit a
     `risk_level`. Returns `{ extraction, tokensIn, tokensOut, costUsd, raw }`.
  2. `src/grounding.ts` — add `groundRiskBrief(extraction, allowlist)` alongside
     `groundFindings`, where `allowlist` is `{ files: Set<string> | string[];
     endpoints: Set<string> | string[] }`. Drop-not-reject semantics identical
     to `groundFindings`: a `Risk` whose `file_refs` contains a path outside
     `files` is dropped; a `ReviewFocusItem` whose `file` is outside `files`, or
     whose `endpoint` (when present) is outside `endpoints`, is dropped; returns
     kept items plus dropped-with-reason for the caller's log. **Do not change
     `groundFindings`' or `groundingSummary`' existing signatures** —
     `groundingSummary` is consumed by run-trace stats; add a separate
     summary/counter if one is needed.
  3. `src/index.ts` — export both, with the same explanatory comment style the
     `classifyIntent` and `groundFindings` export blocks already use.
- **Skills the implementer will apply:** `zod`, `typescript-expert`,
  `security`, `engineering-insights`
- **Depends on:** Step 1 (imports `RiskBriefExtraction` from `@devdigest/shared`)
- **Tests to run/add:** `cd reviewer-core && npm test && npm run typecheck`.
  New test: `reviewer-core/test/risk-brief.test.ts`, mirroring
  `test/intent.test.ts`'s use of a fake `LLMProvider`, covering:
  exactly one `completeStructured` call with `schemaName ==
  'RiskBriefExtraction'`; every untrusted input appears wrapped and the
  injection note is present; `groundRiskBrief` drops a risk citing a
  non-existent file, drops a focus item citing an unknown endpoint, keeps valid
  ones, and returns `{risks: [], review_focus: []}` (not a throw) when
  everything fails (AC13).
  **Done when:** the grounding unit tests pass and `npm run typecheck` is clean.

### Step 3: `server` — `pr_brief` persistence accessors
- **Type:** backend
- **Module/package:** `server/` (**pnpm**)
- **Owned paths (exclusive to this step):**
  new: `server/test/reviews-risk-brief-repo.it.test.ts`;
  modified: `server/src/modules/reviews/repository/pull.repo.ts`,
  `server/src/modules/reviews/repository.ts`
- **What changes:** Add `upsertPrBrief(db, prId, brief)` and
  `getPrBrief(db, prId)` to `pull.repo.ts` next to the existing
  `upsertIntent`/`getIntent` (`pull.repo.ts:49-92`), plus the two thin
  delegating methods on `ReviewRepository` (`repository.ts:141-146` is the
  pattern). Unlike `pr_intent`, `pr_brief` is a single `json` jsonb column
  (`server/src/db/schema/reviews.ts:93-97`) — the whole `PrRiskBrief`, including
  `head_sha`, goes in as one object via `onConflictDoUpdate` on `prId`. The
  read path must `PrRiskBrief.safeParse` the blob and return `undefined` on a
  malformed/legacy row rather than throwing (`json` is untyped `jsonb`, so
  there is no `$type<>` compile-time guarantee — the exact silent-drift case
  root `INSIGHTS.md` 2026-08-23 warns about). **No migration** — the table
  already exists and no column is added.
- **Skills the implementer will apply:** `drizzle-orm-patterns`,
  `postgresql-table-design`, `backend-onion-architecture`, `zod`,
  `typescript-expert`, `security`, `engineering-insights`
- **Depends on:** Step 1 (imports `PrRiskBrief`)
- **Tests to run/add:** `cd server && pnpm typecheck`; DB-backed suite.
  New test: `server/test/reviews-risk-brief-repo.it.test.ts` — inserts a
  workspace/repo/PR, upserts a `PrRiskBrief`, reads it back and asserts full
  equality including `head_sha`; upserts a second time and asserts replacement,
  not duplication; writes a deliberately malformed blob and asserts the read
  returns `undefined` instead of throwing.
  **Done when:** the round-trip test passes against a testcontainers Postgres.

### Step 4: `server` — risk-brief compute orchestration (`getOrComputeRiskBrief`)
- **Type:** backend
- **Module/package:** `server/` (**pnpm**)
- **Owned paths (exclusive to this step):**
  new: `server/src/modules/reviews/risk-brief.ts`,
  `server/test/reviews-risk-brief.test.ts`
- **What changes:** One new application-layer module, structurally a sibling of
  `reviews/intent.ts`, exporting `getOrComputeRiskBrief(container, workspaceId,
  repo, pull, opts, log)` plus small pure helpers. It **imports from
  `intent.ts` read-only** (`getOrComputeIntent`, `isSafePlanRefPath`) and never
  modifies it; likewise it calls `container.repoIntel.getBlastRadius` +
  `getIndexState` and `./blast.js`'s `buildPrBlastRadius` directly (the same
  call shape as `service.ts:279-292`) rather than depending on `ReviewService`,
  so `service.ts` stays out of this step's Owned paths.
  Behaviour, criterion by criterion:
  - **Cache + dedup (AC1-4):** non-forced path reads
    `container.reviewRepo.getPrBrief` first and returns on hit; a
    module-local `inflight: Map<string, Promise<PrRiskBrief|undefined>>` keyed
    by `pull.id`, checked **regardless of `force`**, is shared by concurrent
    callers — copy `intent.ts:346,356-377` exactly, including the
    `.finally(() => inflight.delete(...))`.
  - **Intent first (AC7-8):** call `getOrComputeIntent(..., {force:false}, log)`;
    if it degrades to `undefined`, proceed without an intent section.
  - **Diff stats (AC5-6, OQ7):** its own file-list-only builder — `path
    (+adds/-dels)` lines from `container.reviewRepo.getPrFiles`, capped by a
    **new local constant starting at 20** (matching `MAX_DIFF_STAT_FILES`,
    tunable). `buildDiffStatFallback` and `MAX_DIFF_STAT_FILES` are *not*
    exported from `intent.ts`, so this is a deliberate local copy, not a reuse
    miss. Never any hunk body.
  - **Plan/spec excerpts:** re-extract from `Intent.plan_refs` and re-guard with
    `isSafePlanRefPath(container.git.clonePathFor(repo), path)` before **every**
    `container.git.readFile`, truncating each excerpt. Read failures skip
    silently, as `resolvePlanRefs` does.
  - **Model (AC10):** `resolveFeatureModel(container, workspaceId,
    'risk_brief')` → `container.llm(provider)`. No hardcoded model.
  - **Timeout:** a local `RISK_BRIEF_TIMEOUT_MS` (spec proposes `30_000`),
    forwarded to `extractRiskBrief`.
  - **Grounding (AC11-13):** build the allowlist from the **full**
    `getPrFiles` set (not the truncated in-prompt subset) ∪
    `blast.impacted_endpoints` ∪ `blast.impacted_crons`, call
    `groundRiskBrief`, and log a kept/total line in `groundingSummary`'s style.
  - **`risk_level` (AC14-16):** a pure, exported, separately-unit-testable
    `riskLevelFor(risks: Risk[]): RiskSeverity` = max severity over the
    **post-grounding** list, `'low'` when empty. Same "never a self-report"
    principle as `tierFor` (`intent.ts:102-115`).
  - **Persist (AC17-18):** on success, write the full `PrRiskBrief` (including
    `head_sha: pull.headSha`) via `container.reviewRepo.upsertPrBrief`. On any
    failure/timeout/schema failure, `return undefined` **without writing** —
    leaving any prior cache intact, mirroring `computeIntent`'s
    degrade-to-`undefined` catch (`intent.ts:448-455`). Never persist a partial.
  - **Logging:** reuse the dual-shape `IntentLog`/`logInfo`/`logWarn`
    convention. If those helpers are not exported from `intent.ts`, declare the
    equivalent locally rather than editing `intent.ts`.
  - **Edge cases:** zero changed files / no signal at all must degrade to a
    minimal `what`/`why` with empty arrays and `risk_level: 'low'`, never throw.
- **Skills the implementer will apply:** `backend-onion-architecture`,
  `drizzle-orm-patterns`, `zod`, `typescript-expert`, `security`,
  `engineering-insights`
- **Depends on:** Step 1, Step 2, Step 3
- **Tests to run/add:** `cd server && pnpm typecheck && pnpm test`.
  New test: `server/test/reviews-risk-brief.test.ts` — **hermetic** (no `.it.`),
  mirroring `test/reviews-intent.test.ts`'s stubbed-`Container` approach
  (`{...fakeContainer, reviewRepo: stub} as unknown as Container` — viable
  precisely because this helper uses `container.reviewRepo`, per
  `server/INSIGHTS.md` 2026-08-18). Cover: cached hit returns without an LLM
  call (AC2); two concurrent calls produce exactly one LLM call (AC4);
  ungrounded risks/focus items are dropped and `risk_level` recomputed from the
  survivors (AC11-14); empty post-grounding risks → `'low'` (AC16); an LLM
  throw leaves the existing cached blob untouched and returns `undefined`
  (AC18); a traversal payload in `plan_refs` is never passed to `readFile`;
  zero-changed-files degrades rather than throws.
  **Done when:** all of the above pass hermetically with no network access.

### Step 5: `server` — service method + the two routes
- **Type:** backend
- **Module/package:** `server/` (**pnpm**)
- **Owned paths (exclusive to this step):**
  new: `server/test/reviews-risk-brief-routes.it.test.ts`;
  modified: `server/src/modules/reviews/service.ts`,
  `server/src/modules/reviews/routes.ts`
- **What changes:**
  - `service.ts`: a `getOrComputeRiskBrief(workspaceId, prId, opts, log)`
    method modelled line-for-line on `getOrComputeIntent`
    (`service.ts:212-233`) — workspace-scoped `getPull` → `NotFoundError`,
    `getRepo` → `NotFoundError`, delegate to Step 4's helper, and
    `NotFoundError('PR risk brief not available')` when it degrades to
    `undefined` (which the shared error handler maps to the 404 the client's
    `notComputed` branch keys off).
  - `routes.ts`: `GET /pulls/:id/brief` with `schema: { params: IdParams,
    response: { 200: PrRiskBrief } }` and **no** rate limit (matching
    `GET /pulls/:id/intent`), and `POST /pulls/:id/brief/refresh` with the same
    schema plus `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`
    (AC19, copied from `routes.ts:190-200`). Both resolve `workspaceId` via
    `getContext(container, req)` and pass `req.log`. Update the route inventory
    comment at the top of `routes.ts:10-20`. **No DB access, no business logic
    in the handler.**
- **Skills the implementer will apply:** `fastify-best-practices`,
  `backend-onion-architecture`, `zod`, `typescript-expert`, `security`,
  `engineering-insights`
- **Depends on:** Step 4
- **Tests to run/add:** `cd server && pnpm typecheck`; DB-backed suite.
  New test: `server/test/reviews-risk-brief-routes.it.test.ts`, modelled on
  `test/reviews-intent-routes.it.test.ts`: `GET` computes-if-missing and
  returns 200 with a schema-valid `PrRiskBrief` (AC1); a second `GET` returns
  the same body with **no additional** `MockLLMProvider.calls` entry (AC2);
  `POST .../refresh` recomputes despite the cache (AC3); the response body
  never contains an ungrounded reference; an unknown `:id` → 404.
  Mock via `new MockLLMProvider('openai', { structuredBySchema: {
  RiskBriefExtraction: {...}, IntentExtraction: {...} } })` — `risk_brief`'s
  registry default is provider `openai` (`platform.ts:64-70`), so the
  `openrouter`-not-mocked flake in `server/INSIGHTS.md` (2026-08-18) does not
  apply; the `IntentExtraction` fixture is still needed because AC7 computes
  intent first, and `review_intent` **does** default to `openrouter` — so also
  register an `openrouter` mock or a `feature_models` settings override, per
  that same entry's documented fix.
  **Done when:** `GET`, cached `GET`, and `POST .../refresh` behave per AC1-3
  against a real Postgres with a mocked LLM.

### Step 6: `client` — `usePrBrief` hooks, `PrBriefCard`, `OverviewTab` wiring, i18n
- **Type:** ui
- **Module/package:** `client/` (**pnpm**)
- **Owned paths (exclusive to this step):**
  new: `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/`
  (`PrBriefCard.tsx`, `PrBriefCard.test.tsx`, `styles.ts`, `constants.ts`,
  `index.ts`);
  modified: `client/src/lib/hooks/reviews.ts`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`,
  `client/messages/en/brief.json`
- **What changes:**
  - `lib/hooks/reviews.ts`: `usePrBrief(prId)` — `useQuery(["pr-brief", prId],
    () => api.get<PrRiskBrief>(\`/pulls/${prId}/brief\`))` with the same
    `retry: false on 404` guard as `usePrIntent` (`reviews.ts:98-108`) — and
    `useRefreshPrBrief(prId)` — `useMutation` → `POST .../brief/refresh` with
    the same `setQueryData` + `invalidateQueries` `onSuccess` as
    `useRefreshPrIntent` (`reviews.ts:112-124`). No component ever calls
    `fetch`/`api` directly.
  - `PrBriefCard/`: a `"use client"` component taking
    `{ prId, headSha, onOpenFile? }`. Mounting it is what triggers
    compute-if-missing (AC1), exactly as `IntentCard`'s doc-comment describes.
    State machine copied from `IntentCard.tsx:31-85`: `isLoading` → `Skeleton`
    stack in a `Card` (AC21); `notComputed` (`isError && error instanceof
    ApiError && error.status === 404`) → `EmptyState` using the **existing**
    `unavailable`/`unavailableHint` keys (AC22); other errors → `ErrorState`
    with `onRetry={refetch}`; success → the content. Content: `what`/`why`, a
    risk-level badge (severity → `@devdigest/ui` primitive, colour map in the
    folder's `constants.ts`; no new colour tokens, and never in
    `vendor/ui/styles.css`), the `risks[]` list under the already-present
    `block.risks`/`noRisks` keys, and the `review_focus[]` list. A `Refresh`
    button wired to `useRefreshPrBrief`, mirroring `IntentCard`'s
    `refreshButton` including `loading`/`disabled` handling. A non-blocking
    staleness hint rendered when `headSha && brief.head_sha &&
    headSha !== brief.head_sha` — a hint, never an auto-refetch (AC24).
    Each `review_focus[]` item renders as a real `<button>` with an
    `aria-label` when `onOpenFile` is supplied, calling
    `onOpenFile(item.file, item.line)`; when it isn't, it renders as
    non-interactive text so this step ships and tests standalone.
    Keep the component under ~200 lines — split into
    `PrBriefCard/_components/<Sub>/` if it grows past that (see
    `frontend-architecture`).
  - `OverviewTab.tsx`: render `<PrBriefCard prId headSha onOpenFile={...} />`
    as the **first** child, above `IntentCard` (OQ5 as re-decided this round),
    and add an optional `onOpenFile?: (file: string, line?: number) => void`
    prop to `OverviewTabProps` that is simply forwarded. `headSha` is already
    a prop on `OverviewTab` today — no new threading needed from
    `PrDetailView` for the staleness hint. `IntentCard`, `BlastRadiusCard`,
    `VerdictBanner`, `ReviewRunAccordion` are all untouched.
  - `messages/en/brief.json`: add only the genuinely new keys under the
    existing `brief` namespace (a `riskBrief.*` sub-object for `what`/`why`
    labels, focus-list label, refresh label/tooltip, staleness hint, error
    title/body). **Reuse** the already-present `block.risks`, `noRisks`,
    `unavailable`, `unavailableHint` — do not add parallel keys (client
    `INSIGHTS.md` 2026-08-12). All user-facing strings go through
    `next-intl`; no inline literals. Only the `en` locale exists.
- **Skills the implementer will apply:** `frontend-architecture`,
  `next-best-practices`, `react-best-practices`, `react-testing-library`,
  `security`, `typescript-expert`, `engineering-insights`
- **Depends on:** Step 1 (the client vendored contract). Step 5 for real
  end-to-end verification, but the RTL tests mock at the hook/API boundary, so
  this step is buildable and testable as soon as Step 1 lands.
- **Tests to run/add:** `cd client && pnpm typecheck && pnpm test`.
  New test: `PrBriefCard.test.tsx`, following `IntentCard.test.tsx`'s existing
  mocking convention — 3 flow tests, not many micro-assertions
  (`react-testing-library`): (1) loads → renders `what`/`why`, the risk badge,
  the risks list and a clickable focus item; clicking it calls `onOpenFile`
  with `(file, line)`; the Refresh button fires the mutation. (2) a 404
  renders the unavailable state and no risk badge. (3) a diverged `headSha`
  renders the staleness hint **and** the brief content, and does not trigger a
  refetch.
  **Done when:** the card renders on the Overview tab above Intent, with all
  four states reachable in tests.

### Step 7: `client` — `review_focus` → Files-changed tab jump
- **Type:** ui
- **Module/package:** `client/` (**pnpm**)
- **Owned paths (exclusive to this step):**
  modified:
  `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/PrDetailView.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx`
- **What changes:** Implement AC23 by extending the scroll chain that already
  exists rather than inventing one.
  - `PrDetailView.tsx`: hold a transient focus target in component state shaped
    like `SmartDiffViewer`'s own `ScrollTarget` — `{ path, line?, n }` — where
    `n` is a monotonic nonce so a repeat click on the same item re-triggers the
    scroll (the same target/nonce idea `FileCard`/`CodeLine` already rely on,
    `CodeLine.tsx:40-44`). Pass `onOpenFile={(file, line) => { setFocus({path:
    file, line, n: n+1}); setTab("diff"); }}` down to `<OverviewTab>` (whose
    optional prop Step 6 already declared) and pass the focus target down to
    `<DiffTab>`. Deliberately **not** a URL query param: `router.replace` to an
    identical URL is a no-op, so a second click on the same item would not
    re-scroll; the trade-off is that the jump is not deep-linkable, which no AC
    requires. Note the current tab read is `search.get("tab") ?? "overview"`
    with no whitelist, so `setTab("diff")` works — but re-check before shipping,
    per client `INSIGHTS.md` 2026-08-23's `VALID_TABS` snap-back trap.
  - `DiffTab.tsx`: accept the optional focus target; when one arrives, force
    `order` to `"smart"` — the `"original"` path renders plain `DiffViewer`,
    which has **no** `scrollToLine`/`scrollNonce` props at all
    (`DiffViewer.tsx:14-19`), so a jump silently no-ops there. Forward the
    target to `SmartDiffViewer`.
  - `SmartDiffViewer.tsx`: accept an optional external target prop and merge it
    with the existing internal `target` state (last-write-wins by nonce), so
    finding-badge clicks keep working unchanged. Everything downstream
    (`FileCard.scrollToLine`/`scrollNonce` → `CodeLine.scrollIntoView`) is
    already built and needs no change — and `diff-viewer/*` deliberately has no
    dedicated tests of its own (client `INSIGHTS.md` 2026-08-19), so coverage
    belongs in `SmartDiffViewer.test.tsx`.
  - When the target file is a boilerplate-group file that would default to
    collapsed, it must still open and scroll.
- **Skills the implementer will apply:** `frontend-architecture`,
  `next-best-practices`, `react-best-practices`, `react-testing-library`,
  `security`, `typescript-expert`, `engineering-insights`
- **Depends on:** Step 6 (consumes the `onOpenFile` prop `OverviewTab` gained
  there) — sequential, not parallel-safe with it
- **Tests to run/add:** `cd client && pnpm typecheck && pnpm test`.
  Extend `SmartDiffViewer.test.tsx`: an externally-supplied target scrolls to
  the right file/line without breaking the existing finding-badge click flow;
  a bumped nonce on the same target re-triggers. `jsdom` has no real
  `scrollIntoView`, so assert on the props/target reaching `FileCard` (the
  existing test at `SmartDiffViewer.test.tsx:204` already handles this
  limitation the same way) rather than on actual scrolling.
  **Done when:** clicking a `review_focus` item on Overview lands on the
  Files-changed tab with the cited file expanded and its line highlighted.

### Step 8: Docs — route + hook inventories
- **Type:** cross-cutting (docs-only)
- **Module/package:** `server/` + `client/` (no code)
- **Owned paths (exclusive to this step):**
  modified: `server/README.md`, `client/README.md`
- **What changes:** `AGENTS.md` requires `server/README.md` to be read when
  adding an API route and `client/README.md` when adding a data hook — both
  carry inventories that this feature makes stale. `server/README.md:73-77`'s
  mermaid module map lists the `reviews` module's routes including the
  `/pulls/:id/intent` pair; add the `/pulls/:id/brief` pair, and add a short
  prose paragraph next to the existing intent one at `server/README.md:166-167`
  describing compute-if-missing + the shared in-flight path + the grounding
  gate + server-computed `risk_level`. `client/README.md:18-25`'s hooks
  section gains `usePrBrief`/`useRefreshPrBrief`.
- **Skills the implementer will apply:** per
  `.claude/skills/pr-self-review/references/skill-scope-map.md`'s literal
  file→skill lookup for `**/README.md`; plus the always-on
  `typescript-expert`, `security`, `engineering-insights`. If a diagram edit is
  needed beyond the existing mermaid block, `mermaid-diagram` applies.
- **Depends on:** Step 5, Step 6
- **Tests to run/add:** none (docs-only). **Done when:** the mermaid block
  renders and the two route names + two hook names appear in the inventories
  they belong to.

## 8. Cross-cutting concerns
- **Contract sequencing.** Step 1 is a hard gate: nothing else compiles without
  it, and it must land in **both** vendored trees simultaneously — a
  server-only edit produces no error, just silent client type drift (root
  `INSIGHTS.md` 2026-08-04).
- **No migration anywhere in this plan.** `pr_brief` already exists; `headSha`
  lives inside the `json` blob per OQ4. If an implementer finds themselves
  reaching for `pnpm db:generate`, that is a signal the OQ4 decision is being
  re-litigated — stop and escalate instead.
- **`intent.ts` is read-only for every step.** Steps 4 and 5 import from it
  (`getOrComputeIntent`, `isSafePlanRefPath`) but no step owns it. If a change
  to `intent.ts` turns out to be genuinely necessary (e.g. exporting
  `logInfo`/`logWarn`), that is a plan amendment, not a silent edit — it would
  break Owned-path disjointness.
- **Feature-model resolution is already wired end-to-end.** `risk_brief` is in
  `FEATURE_MODELS` (`platform.ts:64-70`) and `SettingsModels.tsx`'s picker is
  generic over `FeatureModelId` — no Settings UI work, no new registry entry
  (a non-functional requirement of the spec, and confirmed by
  `feature-models.ts`'s `DEFAULTS` map being derived from the registry).
- **Test-hermeticity boundary.** Steps 2, 4 and 6 must be fully hermetic;
  Steps 3 and 5 are `*.it.test.ts` (testcontainers Postgres). Step 5's fixture
  must mock **two** feature models, not one — `risk_brief` (`openai`) and
  `review_intent` (`openrouter` by default), because AC7 computes intent first.
- **Grounding-gate consistency.** Two grounding functions now live in
  `reviewer-core/src/grounding.ts`. Neither `groundFindings` nor
  `groundingSummary` may change shape — `groundingSummary` feeds run-trace
  stats consumed elsewhere.
- **Prompt-cost shape.** Bounded by file-list length, never diff size. Any
  future change that lets hunk bodies into this prompt violates AC6 directly.

## 9. Recommendations
- **Consider making `riskLevelFor` a named export used by the route response
  test, not just internal.** `tierFor` is exported from `intent.ts:102`
  specifically so the deterministic rule can be unit-tested without I/O, and
  `server/INSIGHTS.md` (2026-08-19) records a case where a filter's test was
  written against the wrong layer because ownership wasn't obvious. Cheap to
  do, and it makes AC14/AC16 provable in the hermetic suite. Trade-off: one
  more name in the module's public surface. *(Already folded into Step 4.)*
- **Consider capping `risks[]`/`review_focus[]` length at the contract level.**
  `computeScopeDrift` caps advisory hits at `MAX_SCOPE_DRIFT_HITS = 15`
  (`intent.ts:151-154`) precisely to stop a pathological model output becoming
  a wall of low-value UI noise, and `PrBlastSymbol` caps callers at 20. Nothing
  in SPEC-03 bounds either array. Trade-off: a cap is a silent truncation the
  spec didn't ask for, and grounding already removes the *invalid* items — so
  I'd suggest a generous cap (e.g. 10 review-focus items) as a UI-side slice in
  Step 6 rather than a contract-level `.max()`, keeping the persisted data
  complete. Flagging, not assuming — confirm before implementing.
- **Otherwise the request's scope is already the right one.** In particular, the
  decision to add `contracts/risk-brief.ts` rather than reshape `PrBrief` is
  correct and already has a documented precedent in this repo
  (`blast.ts:1-19`'s own doc-comment, and root `INSIGHTS.md` 2026-08-24) — no
  reason to revisit it.

## 10. Out of scope / explicitly deferred
- **Auto-invalidating the cache on new commits.** Explicit non-goal; the
  staleness hint (AC24) is read-only and nudges toward Regenerate.
- **Any change to `VerdictBanner`, `ReviewRunAccordion`, `IntentCard`,
  `BlastRadiusCard`, or the `reviews`/`findings` pipeline.** OQ5's decision:
  no merge, no new section in an existing component.
- **`brief.ts`'s `PrBrief`/`Risks`/`PrHistory`/`BlastRadius`** — stay untouched
  and still unpopulated. `SmartDiff` is unrelated and unchanged.
- **Spec-conformance checking** — `conformance` is a separate registered
  `FeatureModelId` (`platform.ts:71-77`) with a different job.
- **`git-why`/`WhyTimeline` (`contracts/why.ts`)** — unrelated feature that
  merely shares the word "why". No route or contract name here collides with it.
- **`e2e/` coverage.** `e2e/` is hermetic and makes no LLM calls (`AGENTS.md`);
  a brief inherently requires one. Adding a flow would mean building a
  deterministic brief fixture — a larger piece of work than this spec asks for.
- **A `computed_at` timestamp on `PrRiskBrief`.** Not requested; AC24's
  staleness check is `headSha`-based only. Easy to add later inside the blob
  with no migration if it turns out to be wanted.
- **Deep-linkable `?file=&line=` URLs for the tab jump.** Step 7 uses transient
  component state; no AC requires the jump to survive a reload.
- **A settings UI path for `risk_brief`** — the generic `FeatureModelId` picker
  already covers it.

## 11. Open questions / risks
- **`review_focus` item cap** — see §9's second recommendation. Unresolved
  pending a yes/no; the plan currently persists everything that grounds.
- **Diff-stat width (OQ7)** — deliberately left to implementation, starting at
  20. **Risk:** on a several-hundred-file PR, 20 file rows may starve the model
  and produce a generic `what`/`why`. Resolve empirically during Step 4 against
  a real large PR; no AC depends on the number.
- **30s timeout is a proposal, not a measurement.** `risk_brief` defaults to
  `openai/gpt-4.1` with a much larger prompt than intent's. **Risk:** too short
  → the feature quietly degrades to "unavailable" on big PRs; too long → a
  slow `GET /pulls/:id/brief` blocks the Overview tab's first paint. Needs one
  real timing run in Step 4, not a guess.
- **`brief.json` namespace is shared with `IntentCard` and `WhyTimeline`.**
  Step 6 adds keys to a file `IntentCard.tsx` also reads. Additive-only, so
  safe, but it is the one place a client step touches a file another component
  depends on — worth a grep before renaming anything existing.
- **`jsdom` cannot verify real scrolling** in Step 7; the test asserts the
  target reaches `FileCard`, not that the viewport moved. True end-to-end
  confidence for AC23 requires a manual check against `./scripts/dev.sh`.
- **No external-research dependency identified.** Everything this plan needs is
  in-repo; nothing needs handing to the `researcher` agent.

## 12. Suggested review path (not performed here)
- Before PR: the `pr-self-review` skill, per `AGENTS.md` — it maps the diff to
  `backend-onion-architecture`, `frontend-architecture`, `zod` and `security`
  and blocks on any CRITICAL finding.
- **A dedicated security review is warranted here**, not optional: this feature
  reads repo files at paths derived from untrusted PR/ticket text
  (`isSafePlanRefPath` must run on *every* read), feeds author-controlled text
  into an LLM prompt (`wrapUntrusted` + a new injection note), and renders
  LLM-authored file/endpoint strings to the client only after a mechanical
  grounding gate. Each of those three is an independent failure mode.
- Architecture sign-off is worth it on two §5 constraints in particular: the
  two-copies contract change (Step 1) and the "compute helper must not depend
  on `ReviewService`" call-shape decision in Step 4.
- After merge, per `AGENTS.md`'s "After finishing": record insights via the
  `engineering-insights` skill — likely candidates are the
  `VerdictBanner`-is-not-on-Overview discovery (`client/`) and the two-grounding-
  functions-in-one-file arrangement (`reviewer-core/`).

## Note for the spec author
`specs/03-pr-why-risk-brief.md`'s OQ5 decision text ("above `VerdictBanner`")
is now factually wrong relative to where `PrBriefCard` will actually render
(the Overview tab, above `IntentCard`; `VerdictBanner` lives on the Findings
tab inside `ReviewRunAccordion` and is untouched). This plan documents and
applies the correction (§2, ambiguity 1); the spec itself is unchanged —
amending it is `spec-creator`'s job, not this plan's.
