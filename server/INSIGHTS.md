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

### 2026-08-12 — Skill stats are a category-match approximation, not per-finding attribution

**What:** `SkillsService.getStats`/`list` derive "pull frequency / accept
rate / findings by category" for a skill from real `agent_skills`/`reviews`
/`findings` rows, filtered by a fixed `SkillType → FindingCategory[]` map
(`rubric`/`custom` match every category, `security` matches only
`security`, `convention` matches only `style`) — never from an explicit link
between a finding and the skill that produced it.
**Why:** no such link exists in the schema (`findings` only carries
`review_id`); building one means tagging each LLM finding with which
attached skill(s) actually influenced it — a structured-output/prompt
-assembly change in `reviewer-core`, out of scope for a stats-display
feature.
**Rejected:** fabricated placeholder numbers (looks real, traces to
nothing); a full per-finding `skill_id` captured at review time (correct,
but a much larger, riskier change touching the LLM output schema and every
review call site). `src/modules/skills/helpers.ts`
(`SKILL_TYPE_FINDING_CATEGORIES`, `computeSkillStats`).

### 2026-08-13 — Conventions extraction defaults to a cheap model via the normal `FEATURE_MODELS` registry, not a bespoke override

**What:** the `conventions` `FEATURE_MODELS` entry's default was changed from
`openai/gpt-5.4` to `openrouter/deepseek-v4-flash`, and `ConventionsService`
resolves its model the standard way — `resolveFeatureModel(container,
workspaceId, 'conventions')` — same as every other feature model.
**Why:** extraction runs over dozens of sampled files and every result is
reviewed/edited by the user before being kept, so a strong (expensive) model
isn't worth it by default; a cheap default still leaves the door open to a
per-workspace override via Settings → Models.
**Rejected:** `settings/feature-models.ts`'s doc comment says conventions
should "keep its own dynamic default" and call `getFeatureModelOverride`
directly instead of `resolveFeatureModel`, implying a bespoke
runtime-computed default distinct from the registry's static one. That would
leave the Settings UI showing a default (`gpt-5.4`) that doesn't match what
actually runs — just changing the registry's static default is the smaller,
more honest fix, and nothing else in the codebase has a "dynamic default"
mechanism to justify inventing one here. `src/vendor/shared/contracts
/platform.ts` (`FEATURE_MODELS`), `src/modules/settings/feature-models.ts:30-34`
(comment is now stale — describes an approach that wasn't taken).

### 2026-08-13 — Conventions candidate lifecycle: one `PATCH`, re-scan replaces only the unreviewed

**What:** `PATCH /conventions/:id` takes `{rule?, evidence_snippet?,
accepted?}` — accept, reject, and inline-edit all go through this one
endpoint, not dedicated action verbs. Re-extraction (`POST
/repos/:id/conventions/extract`) deletes only candidates with `accepted =
false` before inserting the fresh batch; accepted rows are never touched by
a re-scan.
**Why:** one candidate card exposes 3 independently-settable actions from
the same place — a single flexible partial-update avoids three near-duplicate
endpoints for it. Re-scan-replaces-non-accepted protects an in-progress
"create skill from accepted candidates" selection from being silently wiped
by a background re-scan, while still avoiding duplicate/stale candidates
piling up across repeated scans.
**Rejected:** matching `findings`' `/accept` + `/dismiss` action-verb pair
(three endpoints instead of one, for one card); matching `skills`' full
`PUT` replace (would force the client to resend the whole candidate on every
accept click); a purely additive re-scan that never deletes anything (no
dedup logic exists in v1, so repeated scans would accumulate near-duplicate
candidates indefinitely). `src/modules/conventions/{routes,service
,repository}.ts`.

### 2026-08-23 — Onboarding generation: permissive LLM schema, strict persistence schema — two Zod schemas for one feature, not one

**What:** `onboarding/prompt.ts`'s `OnboardingGenerationSchema` (the
`completeStructured` boundary) is deliberately permissive — `kind:
z.string()`, uncapped `links` — while the shared `@devdigest/shared`
`Onboarding` contract keeps the narrowed 5-value `kind` enum and is only
`.parse()`d in `service.ts` AFTER `helpers.ts#normalizeTour` has discarded
bad `kind`s, deduped, capped links to 4, and filtered unindexed paths.
**Why:** SPEC-02's ACs require PER-SECTION salvage ("discard that section",
"persist the sections it did return", "persist at most 4 links") — a strict
`z.enum` at the structured-output boundary fails the WHOLE parse (all 5
sections) on one hallucinated `kind`, which a per-section discard rule
cannot survive.
**Rejected:** reusing the shared `Onboarding` contract itself as the
`completeStructured` schema, the way `ConventionExtractionSchema` mirrors
`ConventionCandidate` 1:1 (`conventions/prompt.ts`). That precedent works
there because conventions has no discard/truncate AC — a convention
candidate is either well-formed or dropped whole-array-wise on a schema
mismatch, which is acceptable for that feature but not for a 5-section
document where losing all 5 over 1 bad `kind` fails the "partial" AC
outright. Any future feature with a similar "salvage what's valid, cap the
rest" AC should copy THIS split, not the conventions 1:1 pattern.
`src/modules/onboarding/{prompt,helpers,service}.ts`.

## What Works

- **2026-08-23** — A `GET` fired immediately after `container.jobs.enqueue()`
  resolves (no `setTimeout`/fake timer) reliably observes the job's
  transitional status (`queued`/`running` → derived `generating`), because
  `enqueue()` only awaits the DB insert before returning — the `p-queue`
  callback that flips the row to `running` and calls the handler is
  scheduled via `queue.add()` but not awaited, so it hasn't run yet at the
  point the HTTP response is sent. `test/onboarding.it.test.ts`'s "GET
  reports generating" assertion (right after the POST, before any
  `jobs.onIdle()`) passed deterministically, unforced, across every run.
  Don't add an artificial delay to "wait for the job to start" in a test
  like this — the race is already in the test's favor. `src/platform/jobs.ts`
  (`JobRunner.enqueue`).

_None yet._

## What Doesn't Work

- **2026-08-18** — Any `*.it.test.ts` that POSTs `/pulls/:id/review` and only
  overrides `llm.openai` (the near-universal pattern —
  `overrides: { llm: { openai: MockLLMProvider } }`) is NOT actually
  hermetic on a machine with a real `OPENROUTER_API_KEY` configured in
  `~/.devdigest/secrets.json`: `ReviewRunExecutor.executeRuns` now calls
  `getOrComputeIntent` (Intent Layer, `intent.ts`) once per batch, BEFORE
  the per-agent loop, and that resolves its model via
  `resolveFeatureModel(..., 'review_intent')` → registry default
  `openrouter/deepseek-v4-flash` — a provider these fixtures never mock. With
  no key configured this degrades via `ConfigError` in milliseconds (correct,
  by design); with a real key present it makes a genuine OpenRouter call
  (verified: `curl https://openrouter.ai/api/v1/models` returns `200` in
  ~250ms from this sandbox, and the classify call itself took 2–10s across
  runs), which intermittently exceeds `test/helpers/runs.ts`'s
  `waitForPrRuns` 10s poll window and fails assertions on
  `trace.prompt_assembly` with `Cannot read properties of undefined`. Caused
  2/3 tests in `test/skills-prompt-wiring.it.test.ts` to fail on THIS machine
  only — the hermetic suite (`vitest run --exclude '**/*.it.test.ts'`) is
  unaffected and green. Not fixed here (Step 4's Owned paths are
  `reviews/intent.ts` + `reviews/run-executor.ts` only, not `test/`); a
  follow-up should either have `IntentClassificationInput` accept a short
  `timeoutMs` (reviewer-core's `intent.ts`, currently unbounded — inherits
  the OpenRouter adapter's 90s default) or have it.test fixtures that hit
  `/pulls/:id/review` also stub `llm.openrouter`. **Confirmed 2026-08-18
  (Step 5)** the same flake also fails `test/reviews.it.test.ts`'s
  `"runs a review: map-reduce..."` test on this machine (`expected [] to have
  a length of 1 but got +0`), reproducible standalone with `vitest run
  test/reviews.it.test.ts -t map-reduce`, confirming it's environmental
  (real `OPENROUTER_API_KEY` present) and not specific to the skills-wiring
  file. The workaround used for the new `test/reviews-intent-routes.it.test.ts`
  (which hits `GET/POST /pulls/:id/intent*` directly, so it can't dodge
  `review_intent`'s resolution the way `/pulls/:id/review` fixtures can by
  just not mentioning it): `PUT /settings` with `{ feature_models:
  { review_intent: { provider: 'openai', model: '...' } } }` before exercising
  the route, so `resolveFeatureModel` picks the already-mocked `openai`
  provider instead of the registry's `openrouter` default — same fix shape as
  the suggested "stub `llm.openrouter`" follow-up, but via the workspace
  override path instead of adding a new mock override. **Fixed 2026-08-18**:
  `MockLLMProvider`'s `id` widened to accept `'openrouter'`
  (`src/adapters/mocks.ts`), and `test/reviews.it.test.ts` +
  `test/skills-prompt-wiring.it.test.ts`'s `appWith()` helpers now always add
  an `openrouter: new MockLLMProvider('openrouter', { structuredBySchema: {
  IntentExtraction: {...} } })` entry alongside the review-model mock — no
  `resolveFeatureModel`/settings override needed since the mock now exists for
  whichever provider the registry resolves to. Verified on this machine (real
  `OPENROUTER_API_KEY` present): `vitest run .it.test` green twice in a row,
  67/67, including the previously-flaky "dual-provider structured output" and
  "finding actions: accept, dismiss" tests.
  **Correction, 2026-08-19: the diagnosis above was incomplete — the mock
  fix was necessary but not sufficient, and CI (`server-integration.yml`)
  has NO API keys at all, ruling out "real network call" as CI's failure
  mode.** `test/skills-prompt-wiring.it.test.ts` still failed ~1-in-3 runs
  locally even with the `openrouter` mock in place (`Cannot read properties
  of undefined (reading 'skills')` at `trace.prompt_assembly.skills` — same
  symptom, and it also failed this way in a real GitHub Actions run). Root
  cause: a genuine ordering race in `ReviewRunExecutor.executeRuns`
  (`run-executor.ts`), independent of any LLM provider being real or
  mocked. `completeAgentRun(runId, { status: 'done', ... })` ran INSIDE the
  `withTransaction` block that also inserts the review/findings — meaning
  the transaction commit (making `agent_runs.status = 'done'` visible to
  any concurrent reader) happened BEFORE `saveRunTrace(runId, trace)`,
  which only runs afterward, outside that transaction. `waitForPrRuns`
  (`test/helpers/runs.ts`) polls ONLY `agent_runs.status` — nothing waits
  for the trace document itself. So there was a real (if narrow, ~ms-scale)
  window where a poller sees a terminal status while `GET /runs/:id/trace`
  still 404s (no trace row yet) — the `NotFoundError` response body has no
  `prompt_assembly` key, hence the exact `undefined.skills` crash the test
  reports. The SAME ordering bug existed in the catch-block (failed/
  cancelled path) and in `failAll` (pre-work failure) — `completeAgentRun`
  before `saveRunTrace` in both. **Fixed**: reordered all three paths so
  `saveRunTrace` always runs before `completeAgentRun` — "done"/"failed"/
  "cancelled" now only becomes observable once the trace is durably
  persisted. Verified: 8/8 standalone runs of the previously-flaky file
  green (was ~2/3), plus the full hermetic (191/191) and `.it.test`
  (71/71) suites. **Lesson: a test flake that "goes away" after mocking
  more of the environment isn't proof the mock was the actual root
  cause** — it can just make a real race condition's window bigger or
  smaller (a real network call vs. a fast mock call shifts *when* the
  race is likely to trigger, without removing the race itself). Confirm a
  fix by reproducing the failure BEFORE the change and demonstrating it's
  gone after, not by trusting a plausible-sounding mechanism.
  `server/src/modules/reviews/run-executor.ts`.

- **2026-08-10** — The 2026-07-31 schema-first decision above claims every
  route declares a `response` schema alongside `params`/`body` — in practice
  none do (`grep -c "response:" src/modules/*/routes.ts` → 0 everywhere).
  Only request validation is enforced today; a handler returning a shape
  that doesn't match its DTO fails silently at the client instead of at the
  boundary. Rolling `schema.response` out is real work (every route's actual
  return shape has to be audited against its shared contract) — deferred as
  its own follow-up rather than attempted piecemeal alongside unrelated
  fixes. `src/modules/*/routes.ts`

## Codebase Patterns

- **2026-08-23** — `RepoIntel.getCriticalPaths(repoId)` is implemented, not a
  stub — but it returns `string[][]`, dependency **chains** seeded from
  `CRITICAL_PATH_ROOTS = 5` top-ranked files and walked `BFS_DEPTH` hops along
  `file_edges` (`repo-intel/service.ts:754-795`), not a flat list of
  individually-important files. A UI wanting single annotated files (or a
  "used by N routes" reverse-dependency count) needs a different read —
  `references`/`file_edges` directly — this method will not produce that
  shape. Surfaced writing `specs/02-onboarding-tour.md` (Open question 13),
  whose screenshot showed exactly that mismatched shape.
- **2026-08-20** — `RepoIntel.getBlastRadius`'s `BlastResult.callers` arrives
  at any consumer ALREADY capped to `MAX_CALLERS_PER_SYMBOL` (20) per
  `viaSymbol` — the facade's `capCallersPerSymbol` runs inside
  `tryPersistentBlast`/the ripgrep path before the result is ever returned
  (`repo-intel/service.ts:309,423`). A consumer that needs to know WHETHER a
  symbol's caller list was actually truncated (not just how many callers
  survived) has no true pre-cap count to compare against — the only signal
  left is "this symbol's group hit exactly the cap", which is a heuristic
  (a symbol with precisely 20 real callers reads as truncated too). Used
  this way in `reviews/blast.ts`'s `buildPrBlastRadius` (`PrBlastSymbol
  .callers_truncated`, and via that, `PrBlastRadius.status: 'partial'`). If
  a future consumer needs the exact pre-cap count, it has to be threaded
  through `BlastResult` itself (e.g. a `totalCallersBySymbol` map) rather
  than re-derived downstream — the information doesn't exist past the
  facade boundary. `server/src/modules/repo-intel/service.ts`
  (`capCallersPerSymbol`), `server/src/modules/reviews/blast.ts`.
- **2026-08-19** — When a follow-up needs to add a field to what a route
  returns but the underlying value is CACHED/persisted (like `Intent` on
  `pr_intent`), extend the **transport** type (`PrIntentRecord` in
  `review-api.ts`), not the **persisted** type (`Intent` in `brief.ts`) —
  if the new field doesn't need to be cached (e.g. it's cheap/deterministic
  and depends on data that can change independently, like `scope_drift`
  depending on the PR's current file list rather than the cached intent
  text), computing it at the service layer and merging it into the
  transport object avoids the `.default([])`-breaks-hand-built-literals trap
  (2026-08-18 entry below) entirely — `pull.repo.ts`'s `getIntent()`
  literal never needs to change. `server/src/modules/reviews/service.ts`
  (`getOrComputeIntent`), `server/src/vendor/shared/contracts/review-api.ts`
  (`PrIntentRecord`).
- **2026-08-19** — `ConfidenceNum` (`client/src/vendor/ui/primitives/ConfidenceNum.tsx`)
  hardcodes its own color thresholds (green ≥85%, amber ≥65%, else muted) —
  it has NO knowledge of `tierFor()`'s actual confidence values
  (`server/src/modules/reviews/intent.ts`). The two drifted: `tierFor()`'s
  medium tier was `0.6` (60%), which fell BELOW `ConfidenceNum`'s amber
  threshold and rendered in the same muted-gray as the low/"inferred" tier
  — visually indistinguishable despite being a materially different signal.
  `ConfidenceNum` is vendored (`client/src/vendor/ui/**`, "do not touch" per
  `AGENTS.md`) so the fix has to live on the data side — moved the medium
  tier to `0.7`, still inside the already-documented ~0.55–0.7 band
  (`docs/plans/intent-layer.md`), but picked specifically to clear the
  component's threshold. **Any future change to `tierFor()`'s confidence
  values must be checked against `ConfidenceNum`'s hardcoded 65%/85%
  boundaries** — there's no compiler/test link between the two, only this
  note. `docs/plans/intent-scope-drift.md` §2.
- **2026-08-19** — `buildSmartDiff` (`src/modules/reviews/smart-diff.ts`) never
  sees a finding's `dismissedAt` at all — its `SmartDiffFindingInput` type is
  only `{file, start_line, end_line}`. Dismissed-finding exclusion happens one
  layer up, in `ReviewService.getSmartDiff` (`service.ts`:
  `latestFindings.filter((f) => f.dismissedAt == null)` before calling
  `buildSmartDiff`). A unit test asserting "dismissed findings are excluded"
  against the pure function is a false test — write it against
  `getSmartDiff`/the route instead (this task's
  `test/reviews-smart-diff-routes.it.test.ts` does). Same shape as intent's
  `tierFor()` staying pure while its caller (`getOrComputeIntent`) does the
  I/O/filtering — check which layer a filter actually lives in before
  deciding where its test belongs, don't assume the pure classifier owns it.
- **2026-08-18** — `GitClient.readFile(repo, path)` (`src/adapters/git/simple-git.ts:135-136`)
  does a bare `join(this.clonePathFor(repo), path)` with **no path-traversal
  guard of any kind** — any `..`/absolute segment resolves and reads outside
  the clone. The adapter itself provides no protection; every caller that
  feeds it a path derived from untrusted content (PR body, ticket text, any
  future author-controlled source) is individually responsible for guarding
  it before calling `readFile`. The Intent Layer's plan/spec-reference
  resolver (`src/modules/reviews/intent.ts`) is the one caller that does this
  correctly today — its `isSafePlanRefPath()` (shape allowlist restricting to
  `**/specs/*.md` / `**/docs/**/*.md` / `docs/plans/**`, PLUS a
  `path.resolve()` containment check against the clone root) runs before
  every `readFile` call. Reuse `isSafePlanRefPath`/`isAllowedPlanRefShape`/
  `isWithinClone` (all exported from `intent.ts`) for any new feature that
  needs to read a repo file at a path sourced from untrusted text, rather than
  re-deriving a guard or assuming `readFile` is safe by default.
  **Refined 2026-08-23 building Project Context
  (`specs/01-project-context-plan.md`):** "reuse `isAllowedPlanRefShape`" was
  too broad — that allowlist is scoped to a *different* feature's shapes
  (`specs/*.md` / `docs/**/*.md` / `docs/plans/**`) and widening it to cover
  Project Context's `**/specs/**/*.md` / `**/docs/**/*.md` / bare
  `**/INSIGHTS.md` shapes would have let a PR-intent plan-ref resolve an
  `INSIGHTS.md` path it was never meant to. `server/src/modules/context/helpers.ts`
  instead defines its own project-context-local shape allowlist and composes it
  with the **unchanged, reused** `isWithinClone` — the containment check is the
  generic, safely-reusable half; the shape allowlist is feature-specific and
  should get its own copy rather than widening the existing one. Reuse
  `isWithinClone` by default; only reuse `isAllowedPlanRefShape` itself if the
  new feature's accepted path shapes are genuinely identical to intent's.

- **2026-08-18** — `Container.reviewRepo` (the shared getter, documented in
  `container.ts` as "so consuming modules use `container.reviewRepo` instead
  of reaching into another module's folder") had ZERO real callers before
  `getOrComputeIntent` (`reviews/intent.ts`) — `ReviewService`/
  `ReviewRunExecutor` both construct their own `new
  ReviewRepository(container.db)` in the constructor and thread it through as
  `this.repo` instead. `getOrComputeIntent`'s signature is fixed to
  `(container, workspaceId, repo, pull, opts, log)` (no repository param —
  see `docs/plans/intent-layer.md` Step 4), so it uses `container.reviewRepo`
  directly; this is also what makes it trivially mockable in tests (`{
  ...fakeContainer, reviewRepo: stub } as unknown as Container`), unlike
  `this.repo`-style construction which needs a class-instance cast to
  override. `server/src/modules/reviews/intent.ts`, `server/test
  /reviews-intent.test.ts`.

- **2026-08-18** — `ReviewRepository.getIntent()` coalesces a NULL
  `pr_intent.confidence` to `0` (lowest tier) rather than making the field
  nullable on the `Intent` Zod contract or throwing. `confidence` is a
  required, non-nullable `z.number()` on `Intent`
  (`src/vendor/shared/contracts/brief.ts`) by design — every real write path
  (`getOrComputeIntent`'s `tierFor()`, per the Intent Layer plan's Step 4)
  always sets it, so NULL can only mean a row written before the
  `confidence`/`source`/`plan_refs` columns existed. `source` stays
  `nullish` on the contract and is passed through as-is (`null` is a valid
  `Intent.source` value, unlike `confidence`).
  `server/src/modules/reviews/repository/pull.repo.ts` (`getIntent`).

- **2026-08-12** — `server/src/db/seed.ts` inserts skill rows directly via
  `db.insert(t.skills)`, bypassing `SkillsRepository.insert()` — so seeded
  skills got a `skills.version` column but no matching `skill_versions` row
  until this session added an explicit snapshot insert into the seed loop.
  Any repository method with a side effect beyond the row it writes
  (versioning, an audit trail, a related-table write) is silently skipped by
  direct `db.insert()` in seed/fixture code — check `seed.ts` before
  assuming `GET /skills/:id/versions` returning `[]` is a bug in the
  versions feature itself. `src/db/seed.ts` (skill-seeding loop),
  `src/modules/skills/repository.ts` (`insert`/`snapshotVersion`).

## Tool & Library Notes

- **2026-08-20** — Postgres's `ORDER BY <col> DESC` default is `NULLS
  FIRST`, not `NULLS LAST` (only `ASC` defaults to `NULLS LAST`). This bit a
  `LEFT JOIN file_rank ... ORDER BY rank DESC` query
  (`RepoIntelRepository.getImporters`, blast's reverse-import walk): an
  importer with no `file_rank` row (partial index, or a file the ranker
  skipped) gets `rank: NULL` from the join, and DESC would put every
  unranked importer BEFORE every ranked one — the opposite of "highest rank
  first." The SQL `ORDER BY` is kept only as a best-effort default; the real
  ordering/truncation happens in JS after coalescing `rank ?? 0`
  (`RepoIntelService.walkDownstreamFiles`), which sidesteps the NULLS-FIRST
  trap entirely. Any future `LEFT JOIN ... ORDER BY <nullable> DESC` in this
  codebase needs `NULLS LAST` explicitly (drizzle: no built-in helper for
  this — raw `sql` fragment) or the same "sort defensively in JS" pattern.
  `server/src/modules/repo-intel/repository.ts` (`getImporters`).
- **2026-08-12** — `fflate`'s `unzipSync(data, { filter })` skips
  decompressing an entry the filter rejects entirely — it is not "inflate
  then discard," the rejected entry's bytes are never inflated at all. This
  is a real security property, not just tidiness, for an import feature that
  must never process an archive's executable entries: filtering to `.md`
  /`.txt` before calling `unzipSync` means a `.sh`/binary sibling in the zip
  is never decompressed, let alone read or run. `server/src/modules/skills
  /helpers.ts` (`extractFromZip`).
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

- **2026-08-18** — `@fastify/rate-limit` is never registered when
  `config.nodeEnv === 'test'` (`src/app.ts`: "Disabled under test so
  integration suites can hammer endpoints via inject()") — a per-route
  `config: { rateLimit: {...} } }` (e.g. `POST /pulls/:id/review`, `POST
  /pulls/:id/intent/refresh`) is a no-op against the plugin that never loaded,
  so an `*.it.test.ts` built with the usual `loadConfig({ ...process.env,
  NODE_ENV: 'test' })` helper can fire 100 requests and never see a `429`. To
  actually exercise a route's rate limit, build one dedicated `buildApp()`
  instance with `NODE_ENV: 'production'` (only `nodeEnv` affects log
  pretty-printing and this one plugin gate — safe to flip for a single test
  with mocked adapters). `src/app.ts:95`, test:
  `test/reviews-intent-routes.it.test.ts` ("POST refresh is rate-limited to
  10/minute").

- **2026-08-12** — Wrapping a "delete then bulk-insert" full-replace in a
  `db.transaction()` does NOT make it safe against two overlapping calls
  when the target rows don't exist yet. Postgres only serializes concurrent
  transactions on a shared lock, and `DELETE WHERE agent_id = X` against zero
  existing rows takes no lock — so two transactions both no-op the delete,
  then both plain-INSERT the same `(agent_id, skill_id)` PK and the second
  one 500s with `duplicate key value violates unique constraint
  "agent_skills_agent_id_skill_id_pk"` at commit time, transaction wrap
  notwithstanding. Reproduced by firing two `POST /agents/:id/skills` for a
  freshly-created agent (no prior links) via `Promise.all`. The transaction
  only helps once there's an existing row to lock on the DELETE; the actual
  fix is `.onConflictDoUpdate({ target: [...pk cols], set: { col:
  sql`excluded."col"` } })` on the INSERT itself, which turns the losing
  side of the race into an UPDATE instead of a crash — needed even inside a
  transaction, for any "replace the full set of rows for this key" pattern.
  `src/modules/agents/repository.ts` (`AgentsRepository.setSkills`), test:
  `test/agents-skills-linking.it.test.ts`.
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

- **2026-08-18** — `test/contracts.test.ts`'s `Intent / BlastRadius / Risks /
  PrHistory` test calls `Intent.parse({ intent, in_scope, out_of_scope })`
  with no `confidence`, which now throws (`confidence` is a required
  `z.number()` on `Intent` as of the Intent Layer plan's Step 1 contract
  change, `docs/plans/intent-layer.md`). Not fixed here — `test/` is outside
  Step 2's Owned paths (`server/src/db/schema/reviews.ts`,
  `.../repository/pull.repo.ts`, `.../repository.ts`, migrations only); the
  fixture needs a `confidence` field added, or `test-writer`'s pass should
  pick it up. `server/test/contracts.test.ts:68-71`. **Fixed — already
  resolved by the time of the 2026-08-18 test-writer pass**: the fixture at
  that line already includes `confidence: 0.5`; `pnpm exec vitest run
  --exclude '**/*.it.test.ts'` passes `test/contracts.test.ts` (8/8) as-is.
  Resolved by some other change in the same working tree before this
  question was acted on — no edit was needed.
