# Development Plan: SPEC-03 amendment — 8,000-token risk-brief prompt budget

## 1. Summary
The risk-brief prompt currently bounds each input independently
(`MAX_RISK_BRIEF_DIFF_STAT_FILES`=20, `MAX_RISK_BRIEF_BLAST_SYMBOLS`=20,
`MAX_RISK_BRIEF_PLAN_EXCERPT_CHARS`=20_000) but never measures the assembled
whole, so a PR under every per-section cap can still produce an oversized
prompt. This amendment adds a whole-prompt budget of 8,000 tokens — measured
with the existing `Tokenizer` adapter immediately before the single
`completeStructured` call — enforced by prioritized, re-measured trimming of
supplementary sections (plan/spec excerpts → diff-stat rows → blast symbols →
ticket body), never trimming title/description/injection note/output schema,
logging any trim, and falling through to the *existing* AC18 degrade path in
the pathological case. Nothing persisted changes shape; no route, contract,
migration, or client change.

## 2. Requirements reviewed
- **Supplied:** `specs/03-pr-why-risk-brief.md` — AC25-35 ("Token budget:"
  group, lines 155-197), the "Prompt token budget" NFR (lines 315-329), the
  "Assembled prompt exceeds the token budget" edge case (lines 276-286), and
  Open questions item 8 (lines 522-550). Status: `approved`. The base feature
  is merged (`5eabeb4`).
- **Prior plan for the base feature:** `specs/03-pr-why-risk-brief-plan.md`
  (8 steps, multi-agent). Read for step boundaries and Owned-path
  conventions; this plan deliberately does **not** re-plan those steps.
- **Ambiguities found and resolved with the product owner this round (3):**
  1. **AC25's "combined token count".** **Decision:** sum of two per-message
     counts — `count(system) + count(user)` — the literal reading of "its
     system content and its user content".
  2. **AC31's excerpt ladder.** **Decision:** drop from the end of the
     `plan_refs`-ordered list one at a time (re-measuring per AC29/30) until
     one excerpt remains, then reduce that survivor's truncation length,
     then drop it entirely.
  3. **AC28's "linked-ticket body" — is the ticket title trimmable?**
     **Decision:** no — drop `ticket.body` only; `ticket.title` is never
     trimmed and becomes non-trimmable residue that can only reach AC34 if
     everything else fails to bring the prompt under budget.
- **Not re-litigated:** OQ8's decision (8,000 tokens, `Tokenizer.count()` as
  the definition of a token, no new counting logic) is taken as given.

## 3. Context reviewed
- `specs/03-pr-why-risk-brief.md` — the amendment itself; the only spec file
  relevant. `server/specs/`, `reviewer-core/specs/` contain only `README.md`
  placeholders.
- `server/docs/`, `reviewer-core/docs/` — no per-feature doc for the risk
  brief exists; its prose documentation lives in `server/README.md:174-193`
  ("The PR risk brief is compute-if-missing, same shape as intent") and
  needs a sentence about the budget.
- `reviewer-core/INSIGHTS.md` — nothing on token budgets. Relevant: a
  2026-08-24 entry on keeping the two grounding gates separate rather than
  abstracting (a caution against premature generalization that applies to
  the trim helper too).
- `server/INSIGHTS.md` / root `INSIGHTS.md` — no prior entry on token
  budgeting beyond the repo-map usage. Root `INSIGHTS.md` 2026-08-04 (two
  independent hand-copied `vendor/shared` trees) is **not** triggered here:
  this amendment touches no contract.
- `reviewer-core/AGENTS.md` conventions relevant here: purity is the
  contract (no DB/fs/network beyond the injected `LLMProvider`); npm not
  pnpm; typecheck *is* the build; adding an export is an API change — check
  `server/` consumers first; the public surface is `src/index.ts`.
- `server/AGENTS.md` conventions relevant here: external I/O behind a
  container adapter swappable via `src/adapters/mocks.ts`; `*.it.test.ts` =
  DB-backed, everything else hermetic; pnpm.
- Existing patterns to reuse (each verified, not inferred):
  - `server/src/modules/repo-intel/pipeline/repo-map.ts:28-57` —
    `renderRepoMap(candidates, tokenizer, budget): { text, tokens }`: a
    **pure, server-side, fit-to-budget loop taking `Tokenizer` as a
    parameter**. This is the exact precedent for where budget logic lives in
    this codebase, and the signature shape to mirror.
  - `server/src/platform/container.ts:139-142` — `container.tokenizer`,
    overridable via `ContainerOverrides.tokenizer` (`container.ts:58`) for
    hermetic tests.
  - `server/src/adapters/tokenizer/index.ts:19-43` — `Tokenizer.count()`,
    `TiktokenTokenizer` with the `approxTokens()` = `ceil(len/4)`
    never-throw fallback. The spec defines "token" as exactly this.
  - `server/src/modules/context/service.ts:86` — second existing
    `container.tokenizer.count()` consumer, cited by the spec's NFR.
  - `reviewer-core/src/review/risk-brief.ts:127-170` — the private
    `buildMessages(input)`, the only place the assembled system+user content
    exists.
  - `reviewer-core/src/grounding.ts:87-90` (`groundingSummary`) and
    `:181-185` (`riskBriefGroundingSummary`) — the `kept/total passed`
    log-line style AC35 must mirror; already consumed at
    `server/src/modules/reviews/risk-brief.ts:330`.
  - `server/src/modules/reviews/risk-brief.ts:80-90` — local
    `logInfo`/`logWarn` over the dual `IntentLog` (RunLogger | Fastify
    logger) seam; AC35's log line uses these, not a new logger.
  - `server/src/modules/reviews/risk-brief.ts:353-361` — the existing
    `catch` that logs and returns `undefined` without persisting. **AC34
    reuses this; no new failure branch.**

## 4. Modules affected
| Module | Package manager | Why touched |
|---|---|---|
| `reviewer-core/` | **npm** | Expose the existing private prompt assembler so the server can measure the *actual* messages that will be sent (no duplicated prompt text, no drift). |
| `server/` | **pnpm** | Application-layer measure → trim → re-measure loop in `modules/reviews/risk-brief.ts` using `container.tokenizer`; the trim log; the AC34 abandon path. |
| `server/src/vendor/shared` | — | **Not touched.** No contract change (`PrRiskBrief`/`RiskBriefExtraction` are unchanged), therefore no dual vendor-copy sync. |
| `client/` | — | **Not touched.** See §10. |

## 5. Architectural constraints
- **The seam decision (the core architectural call in this plan): the trim
  loop lives in `server/`, and `reviewer-core` exports its prompt
  assembler.** Concretely: extract `reviewer-core/src/review/risk-brief.ts`'s
  private `buildMessages` into an exported
  `buildRiskBriefMessages(input): ChatMessage[]` (still used internally by
  `extractRiskBrief`, so measured ≡ sent), and have
  `server/src/modules/reviews/risk-brief.ts` run the measure/trim/re-measure
  loop against it with `container.tokenizer`. Two alternatives were
  considered and rejected:
  - *Rejected — inject a `count(text): number` into `extractRiskBrief` and
    trim inside `reviewer-core`.* AC31/32 require trimming by **structure**
    (drop `plan_refs` from the end; keep diff rows with the largest
    additions+deletions), and `reviewer-core` receives `diffStat`/
    `blastSummary` as **pre-rendered strings** (`risk-brief.ts:53-58`).
    Making them trimmable there means reshaping `RiskBriefExtractionInput`
    into structured rows and moving signal-shaping into a package whose own
    doc-comment states signal-gathering happens in the caller
    (`reviewer-core/src/review/risk-brief.ts:20-25`). AC35 would
    additionally need a **second** injected capability (a logger) into a
    package that has none.
  - *Rejected — server measures without a shared assembler.* Would force the
    server to re-implement `SYSTEM_PROMPT` + `RISK_BRIEF_INJECTION_NOTE` +
    the `wrapUntrusted` section layout to estimate size; any prompt edit in
    `reviewer-core` would then silently invalidate the measurement.
    Unacceptable drift risk.
  - *Accepted, because:* `renderRepoMap(candidates, tokenizer, budget)`
    already establishes "pure render function + `Tokenizer` + fit-to-budget
    loop, in the server" as this repo's pattern; the structured data
    AC31/32 need already lives in `computeRiskBrief`; `container.tokenizer`
    is legitimately reachable from the application layer; and AC34/AC35
    land on the existing catch and the existing `logInfo` seam with no new
    machinery.
- `reviewer-core` purity holds unchanged — **no new injected capability at
  all** under this seam; the only change is visibility of an already-pure
  function.
- Adding `buildRiskBriefMessages` to `reviewer-core/src/index.ts` is an API
  change per `reviewer-core/AGENTS.md`; the only consumers are
  `server/src/modules/reviews/risk-brief.ts` and
  `reviewer-core/test/risk-brief.test.ts`.
- Onion layering: all budget logic stays in `modules/reviews/risk-brief.ts`
  (application layer, may use `container.*`). No route file changes;
  `routes.ts`/`service.ts` are untouched.
- `reviewer-core` emits no JS — its build is `npm run typecheck`. Never run
  pnpm in it; never run npm in `server/`.
- The **grounding allowlist must remain the full, untrimmed sets**
  (`allowlistFiles` from `getPrFiles`, `allowlistEndpoints` from the
  uncapped `impacted_endpoints`/`impacted_crons`, `risk-brief.ts:282,292`).
  Trimming changes only what is *shown* in-prompt; narrowing the allowlist
  alongside a trim would silently drop legitimate citations and violate
  AC11-12 and the spec's "very large PR" edge case.

## 6. Execution mode
- **Confirmed with user: multi-agent.** Two steps, strictly sequential via
  `Depends on` (Step 2 needs Step 1's export) — no parallelism is gained by
  this split (both steps touch a shared invariant, "measured ≡ sent," so
  they cannot safely run concurrently), but each step is a disjoint
  Owned-path unit and can be run as two separate `implementer` instances in
  sequence, or via `/run-plan mode:multi`.

## 7. Steps

### Step 1: Expose `reviewer-core`'s risk-brief prompt assembler
- **Type:** core
- **Module/package:** `reviewer-core/` (**npm**)
- **Owned paths (exclusive to this step):** modified:
  `reviewer-core/src/review/risk-brief.ts`, `reviewer-core/src/index.ts`,
  `reviewer-core/test/risk-brief.test.ts`, `reviewer-core/README.md`
- **What changes:**
  - Rename/extract the private `buildMessages` (`risk-brief.ts:127-170`)
    into an exported `buildRiskBriefMessages(input): ChatMessage[]`,
    behaviour byte-identical, still called by `extractRiskBrief` so what the
    server measures is exactly what gets sent.
  - Split the input type so the assembler takes only the content fields:
    introduce a `RiskBriefPromptInput` (title, description, intent,
    blastSummary, diffStat, ticket, planExcerpts) that
    `RiskBriefExtractionInput` extends with the call-time fields (`llm`,
    `model`, `sessionId`, `maxRetries`, `timeoutMs`). The server assembles
    content before it resolves the model, so it must be able to measure
    without an `llm`/`model` in hand.
  - Add both to `src/index.ts`'s exports (block at `index.ts:76-86`) and add
    `extractRiskBrief`/`groundRiskBrief`/`riskBriefGroundingSummary`/
    `buildRiskBriefMessages` to `README.md`'s "Public API" paragraph
    (`README.md:71-79`, currently stale since the base feature merge — see
    §9).
  - Extend the doc-comment to state the contract that makes the server-side
    seam safe: this function is pure and deterministic, callers may invoke
    it repeatedly to measure candidate assemblies, and `extractRiskBrief`
    sends exactly its output.
  - **No behavioural change.** No budget logic, no tokenizer, no new
    dependency in this package.
- **Skills the implementer will apply:** `zod`, `typescript-expert`,
  `security`, `engineering-insights`
- **Depends on:** none
- **Tests to run/add:** `cd reviewer-core && npm test && npm run
  typecheck`. New test in `reviewer-core/test/risk-brief.test.ts`:
  **anti-drift** — call `buildRiskBriefMessages(input)`, then call
  `extractRiskBrief` with the same input against `MockLLMProvider`, and
  assert the captured `req.messages` deep-equals the builder's output. This
  is the guard that keeps "measured" ≡ "sent" for all time.
- **Done means:** `reviewer-core` typechecks, all existing tests still pass
  unchanged, and the new anti-drift test passes.

### Step 2: Enforce the 8,000-token prompt budget with prioritized trimming
- **Type:** backend
- **Module/package:** `server/` (**pnpm**)
- **Owned paths (exclusive to this step):** modified:
  `server/src/modules/reviews/risk-brief.ts`,
  `server/test/reviews-risk-brief.test.ts`, `server/README.md`; new
  (optional, if the implementer prefers a separate suite):
  `server/test/reviews-risk-brief-budget.test.ts`
- **What changes:**
  - **Constant:** `RISK_BRIEF_PROMPT_TOKEN_BUDGET = 8_000`, doc-commented
    alongside the existing `MAX_RISK_BRIEF_*` constants
    (`risk-brief.ts:43-66`) and citing AC26/OQ8 as its source (a decided
    value, not a measurement).
  - **Pure, exported, testable fitter** mirroring `renderRepoMap`'s
    signature shape: `fitRiskBriefPromptToBudget(sections, tokenizer,
    budget)` — a plain exported function taking `Tokenizer` as a parameter
    (not reaching into `container.tokenizer` internally), returning the
    final `RiskBriefPromptInput` plus a per-section kept/total trim report
    and the final token count. It re-renders diff-stat and blast-summary
    blocks at candidate sizes (reusing the existing `buildDiffStat`/
    `buildBlastSummary` helpers, generalized to take a row/symbol limit) and
    measures each candidate via `buildRiskBriefMessages` +
    **`tokenizer.count(system) + tokenizer.count(user)`** (AC25, per the
    confirmed decision above — sum of two per-message counts).
  - **Measurement point:** immediately before `extractRiskBrief` in
    `computeRiskBrief` (currently `risk-brief.ts:312-324`), after every
    signal is assembled (AC25).
  - **Under budget → nothing changes** (AC27): the same sections,
    unmodified, and no trim log.
  - **Trim ladder, re-measuring after every step and stopping the instant
    the count is ≤ budget** (AC28-30):
    1. **Plan/spec excerpts** — drop from the end of the array (preserves
       `Intent.plan_refs` order, since `resolvePlanExcerpts`
       (`risk-brief.ts:203-215`) iterates `planRefs` in order) **one at a
       time, re-measuring after each drop, until one excerpt remains**; then
       reduce that survivor's truncation length below
       `MAX_RISK_BRIEF_PLAN_EXCERPT_CHARS` via a small fixed ladder; then
       drop it entirely (AC31, per the confirmed decision above).
    2. **Diff-stat file rows** — re-render below
       `MAX_RISK_BRIEF_DIFF_STAT_FILES`, **sorted to retain the largest
       `additions + deletions`, with a stable tiebreak on file path** when
       churn is equal (AC32; only when trimming is active — this changes
       selection order from today's plain `slice(0, 20)` at
       `risk-brief.ts:126-129`, and the stable tiebreak avoids the same PR
       producing two different prompts across runs). Floor is the header
       line alone (`N file(s) changed (+x/-y)`), never nothing.
    3. **Blast-radius symbols/callers** — re-render below
       `MAX_RISK_BRIEF_BLAST_SYMBOLS`, keeping the `status:` line and the
       `Endpoints:`/`Crons:` lines (those are what `review_focus.endpoint`
       citations are grounded against).
    4. **Linked-ticket body** — drop `ticket.body` only; `ticket.title` is
       never trimmed (AC28, per the confirmed decision above).
  - **Never trimmed at any step** (AC33): PR title, PR description, and —
    structurally guaranteed, since they live inside `reviewer-core` and are
    never inputs to the fitter — the injection-defense note and the
    output-schema instructions including the `risk_level`-exclusion
    sentence. Write this guarantee down in the doc-comment.
  - **Exhausted and still over budget** (AC34): throw a clearly-messaged
    error from inside `computeRiskBrief`'s existing `try` **before**
    `extractRiskBrief` is reached, so the existing `catch`
    (`risk-brief.ts:353-361`) logs "compute failed — leaving cache
    untouched" and returns `undefined`. No LLM call, no `upsertPrBrief`, no
    second failure branch — this is AC18's path, per the spec's edge-case
    text.
  - **Trim log** (AC35): a single `logInfo` emitted only when any trimming
    was applied, in `groundingSummary()`'s kept/total register — per-section
    kept/total plus before→after token counts and the budget, e.g. `PR risk
    brief: prompt trimmed — plan excerpts 1/4, diff rows 6/20, blast symbols
    20/20, ticket body dropped; 12043→7810 tokens (budget 8000)`. Exact
    wording is the implementer's; the required content is kept-and-dropped
    **per trimmed section**.
  - **Explicitly unchanged:** `allowlistFiles`/`allowlistEndpoints`
    construction, `groundRiskBrief`, `riskLevelFor`, `upsertPrBrief`, the
    persisted `PrRiskBrief` shape, `RISK_BRIEF_TIMEOUT_MS`, and every route.
  - **`server/README.md:174-193`:** add one or two sentences that the
    assembled prompt is capped at 8,000 tokens (counted with the
    `Tokenizer` adapter) and trimmed in a fixed priority order, degrading
    via the existing path if it can't fit.
- **Skills the implementer will apply:** `backend-onion-architecture`,
  `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`,
  `zod`, `security`, `typescript-expert`, `engineering-insights`
- **Depends on:** **Step 1** — needs the exported `buildRiskBriefMessages`/
  `RiskBriefPromptInput`. Sequential; not parallel-safe with it.
- **Tests to run/add:** `cd server && pnpm exec vitest run --exclude
  '**/*.it.test.ts'` then `pnpm typecheck`. All new tests are **hermetic**
  (`*.test.ts`) — no DB, no new `*.it.test.ts`.
  - **Gotcha the implementer must handle first:** `makeContainer` in
    `server/test/reviews-risk-brief.test.ts:87-143` builds a hand-rolled
    `Container` cast that has **no `tokenizer` key** — every existing test
    in that file will throw the moment the new code reads
    `container.tokenizer` unless a stub counter is added there. Use a
    deterministic stub (e.g. `count: (t) => Math.ceil(t.length / 4)`,
    matching `approxTokens`) so assertions don't depend on real tiktoken
    numbers.
  - New tests: (a) under budget → all sections present, no trim log, one
    `RiskBriefExtraction` call (AC27); (b) over budget → excerpts dropped
    one at a time before diff rows, diff rows kept by largest churn with a
    path tiebreak, stops as soon as under (AC28-32) — assert on the
    messages the `MockLLMProvider` captured; (c) title + description
    survive even at an absurdly small budget (AC33); (d) unfittable → no
    `RiskBriefExtraction` `completeStructured` call, `upsertPrBrief` never
    called, prior cached brief untouched, returns `undefined` (AC34); (e)
    trim log emitted with per-section kept/total (AC35) — assert on the
    `RUN_LOG.info` spy; (f) ticket title survives while ticket body is
    dropped, confirming the AC28 decision; (g) regression: a file trimmed
    out of the in-prompt diff stat is still accepted by grounding (allowlist
    untouched).
- **Done means:** with a stubbed over-budget tokenizer, the captured LLM
  request contains a demonstrably trimmed prompt under budget with
  title/description intact; with an unfittable one, no LLM call is made and
  `getOrComputeRiskBrief` returns `undefined` with the cache untouched; the
  whole hermetic server suite and `pnpm typecheck` pass.

## 8. Cross-cutting concerns
- **Ordering:** Step 1 before Step 2 — the server cannot measure what it
  cannot assemble. No contract (`@devdigest/shared`) change exists in this
  amendment, so the usual "contracts first, both vendor copies" sequencing
  does not apply and the root `INSIGHTS.md` 2026-08-04 dual-vendor-tree
  hazard is not in play.
- **Measured ≡ sent** is the load-bearing invariant of this design; Step 1's
  anti-drift test is what enforces it. If a future change makes
  `extractRiskBrief` build messages differently from
  `buildRiskBriefMessages`, the budget silently becomes fiction — that test
  must not be deleted.
- **No migration, no feature flag, no new `FeatureModelId`.** Behaviour
  change is confined to prompts that were previously oversized; every
  under-budget PR produces a byte-identical prompt to today.
- **Per `AGENTS.md` "After finishing":** record what was learned in
  `reviewer-core/INSIGHTS.md` (Step 1) and `server/INSIGHTS.md` (Step 2) via
  the `engineering-insights` skill — the seam decision in §5 (and the two
  rejected alternatives) is exactly the kind of non-obvious call those files
  exist for. This is the implementer's closing action, not a plan step.

## 9. Recommendations
- **`reviewer-core/README.md:71-79`'s "Public API" paragraph is stale from
  the base feature merge** — it lists `classifyIntent` and its types but not
  `extractRiskBrief`, `groundRiskBrief`, or `riskBriefGroundingSummary`, all
  of which shipped in `5eabeb4`. Since Step 1 already owns that file, adding
  the missing names costs nothing. *(Already folded into Step 1.)*
- **The fitter is a pure exported function taking `Tokenizer` as a
  parameter**, mirroring `renderRepoMap`'s proven signature — makes every
  AC28-33 assertion a plain unit test with no `Container` cast at all.
  *(Already folded into Step 2.)*
- **Do not generalize this into a shared "prompt budget" utility yet.**
  `reviewer-core/INSIGHTS.md`'s 2026-08-24 entry made exactly this call for
  the two grounding gates — keep per-domain logic separate until a third
  consumer exists. `renderRepoMap` and this fitter share a shape but not a
  domain.
- **A linear ladder over a binary search.** `renderRepoMap` binary-searches
  because it has one homogeneous, ranked list; here the ladder is
  heterogeneous and strictly ordered by AC28, and AC29/30 mandate
  re-measurement after each step with early stop — a straightforward
  sequential ladder is both simpler and a closer match to the spec's
  wording.

## 10. Out of scope / explicitly deferred
- **Client: no changes.** `PrBriefCard` and every hook consuming `GET
  /pulls/:id/brief` are untouched because trimming is invisible to the API
  response: the persisted/returned `PrRiskBrief`
  (`{what, why, risks, review_focus, pr_id, risk_level, head_sha}`, built at
  `server/src/modules/reviews/risk-brief.ts:334-342`) has exactly the same
  shape whether the prompt was trimmed or not. The AC34 case surfaces
  through the *already-implemented* AC18/AC22 unavailable-state path the
  card already renders. No `next-intl` string is added.
- No `@devdigest/shared` contract change, therefore no
  `client/src/vendor/shared` sync.
- No DB migration, no `pr_brief` column, no schema change — the amendment is
  prompt-assembly logic only.
- No route, `service.ts`, or rate-limit change; no new `FeatureModelId`.
- No e2e change — `e2e/` is hermetic with no LLM calls, so a prompt-size
  budget is unobservable there.
- Re-planning the base SPEC-03 feature (AC1-24) — already implemented and
  merged in `5eabeb4`.
- Tuning the per-section caps themselves (OQ7's "raise the 20-file cap if
  real large-PR testing shows it starves the model") — independent of this
  amendment and still open.
- Emitting the trim report through the run trace / `PromptAssembly` — AC35
  asks for a log line only.

## 11. Open questions / risks
- **Risk — the 8,000-token budget is a decided number, not a measured one**
  (OQ8), and the base implementation's own comments already flag
  `RISK_BRIEF_TIMEOUT_MS`/`MAX_RISK_BRIEF_DIFF_STAT_FILES` as "tune during
  implementation" values (`risk-brief.ts:43-66`). A real large PR may
  routinely trim away most plan-excerpt signal at 8k. Nothing external is
  needed to resolve this — but expect a follow-up tuning decision after real
  runs, and keep the constant single-sourced and doc-commented so it is a
  one-line change.
- **Risk — the existing hermetic test container has no `tokenizer`.**
  Flagged in Step 2; it will surface as an immediate failure across all six
  existing `getOrComputeRiskBrief` tests, which is loud rather than silent,
  so low severity.
- **No external research needed.** Everything this amendment depends on
  (`js-tiktoken` `cl100k_base` behaviour, the `Tokenizer` interface,
  `MockLLMProvider`'s call capture) is already in-repo; nothing needs the
  `researcher` subagent.

## 12. Suggested review path (not performed here)
- Before PR: the `pr-self-review` skill, per root `AGENTS.md` — the diff
  maps to `backend-onion-architecture` (Step 2) and `typescript-expert`
  (both steps).
- **Security angle worth a dedicated look, even though it looks like a size
  change:** AC33's never-trim set includes the injection-defense note and
  the output-schema instructions. Under this plan those are structurally
  untrimmable because they live in `reviewer-core` and are never inputs to
  the fitter — a reviewer should confirm that structural guarantee actually
  holds in the implementation rather than taking the comment's word for it.
  Also confirm the grounding allowlist was not narrowed alongside any trim
  (`risk-brief.ts:282,292`).
- Architecture sign-off on §5's seam decision (server-side trim + exported
  assembler) before Step 1 lands — it is the one non-trivial call here and
  it changes `reviewer-core`'s public surface.
