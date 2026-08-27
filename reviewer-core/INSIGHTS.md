# Insights — reviewer-core

Engine decisions and dead ends. Read before changing prompt assembly, structured
output, or grounding — the constraints here are deliberate.

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
them here.

---

## Decisions

### 2026-07-31 — Mechanical grounding gate, not a trusted model

**What:** every finding must cite a real line in the diff or it is dropped, and
the verdict score is recomputed from the surviving findings.
**Why:** the model reliably invents plausible line references, and a citation
check is verifiable where a self-reported confidence is not.
**Rejected:** trusting the model's own locations and score. Findings pointed at
lines that were not in the diff, and the score did not move when they were
removed.

## What Works

_None yet._

## What Doesn't Work

_None yet._

## Codebase Patterns

- **2026-08-26** — A "what fraction of findings cited a real line?" metric
  CANNOT be computed from `reviewPullRequest`'s returned findings.
  `ReviewOutcome.review.findings` is already **post**-gate — `run.ts:206`
  calls `groundFindings` and only `ground.kept` survives into `review`, so
  any ratio derived from it is `1.0` by construction. The pre-gate total
  exists only on the outcome's sibling fields: `grounding` (a human string,
  `"3/4 passed"`, from `groundingSummary`) and `dropped[]` (the dropped
  findings + reasons). The honest formula is
  `kept.length / (kept.length + dropped.length)`, i.e.
  `review.findings.length / (review.findings.length + dropped.length)` —
  and the `0/0` case (model produced nothing) has to be defined by the
  caller, since neither field distinguishes "nothing produced" from
  "nothing dropped". Surfaced designing SPEC-04's `citation_accuracy`
  (`specs/04-eval-pipeline.md` AC 31-32). `reviewer-core/src/review/run.ts:106-109,205-219`.

- **2026-08-24** — when a package-internal prompt assembler needs to become
  measurable by a caller (e.g. `server/` fitting a prompt to a token
  budget), split the input type rather than exporting the full call-time
  input: `risk-brief.ts`'s `buildMessages(input: RiskBriefExtractionInput)`
  became `export function buildRiskBriefMessages(input:
  RiskBriefPromptInput)`, where `RiskBriefPromptInput` holds only the
  content fields (title/description/intent/blastSummary/diffStat/ticket/
  planExcerpts) and `RiskBriefExtractionInput extends RiskBriefPromptInput`
  adds the call-time fields (`llm`, `model`, `sessionId`, `maxRetries`,
  `timeoutMs`). This lets a caller assemble/measure content before it has
  resolved a model. Guard the "measured ≡ sent" invariant with an
  anti-drift test that calls the exported assembler directly, then calls
  the real extraction function with the same content and asserts the
  captured `LLMProvider` request's `messages` deep-equals the assembler's
  output — `test/risk-brief.test.ts`'s "anti-drift" test. If a future
  edit makes the extraction function build messages differently from the
  exported assembler (e.g. post-processing the array before sending), this
  is the test that catches it; don't delete or weaken it.
- **2026-08-24** — `grounding.ts` now holds two independent gates:
  `groundFindings`/`groundingSummary` (diff-line citations, for
  `reviewPullRequest`) and `groundRiskBrief`/`riskBriefGroundingSummary`
  (file/endpoint citations, for `extractRiskBrief` in `review/risk-brief.ts`).
  Deliberately not merged into one generic gate — the input shapes (a
  `Finding` with `start_line`/`end_line` vs. a `Risk`'s `file_refs[]` /
  `ReviewFocusItem`'s `file`+`endpoint`) and drop granularity (per-line-range
  vs. per-citation) differ enough that a shared abstraction would add
  indirection without removing duplication. If a third citation-style gate is
  ever added, reconsider a shared `dropped: {reason}` type at minimum, but
  keep the per-domain check functions separate.
- **2026-08-18** — a new optional `PromptParts` slot (e.g. `intent`) that gets
  written into `assemblePrompt`'s `assembly` trace object must ALSO be added
  to the `PromptAssembly` Zod schema in
  `server/src/vendor/shared/contracts/trace.ts`, not just to `PromptParts`
  here. The `assembly` local in `prompt.ts` is declared `const assembly:
  PromptAssembly = {...}`, so an extra key fails typecheck immediately — but
  even without the type annotation it would silently succeed then get
  stripped later when the server calls `RunTrace.parse()` to persist the
  trace (`z.object()` strips unknown keys by default). `trace.ts` isn't
  listed as an Owned path for any step in `docs/plans/intent-layer.md`'s
  contracts step — it's a gap in that plan's path table, not an oversight to
  repeat: whichever slot you add here, check `trace.ts` too. **Naming
  gotcha (found in post-merge review, fixed 2026-08-20):** the trace field
  name must mirror the `PromptParts` field's own base name, not gain an
  unrelated prefix — `repoMap`→`repo_map`, `prDescription`→`pr_description`
  (that one already starts with "pr"), but `intent` (no "pr" prefix) was
  shipped as `pr_intent`, breaking that pattern and creating a public-contract
  naming mismatch between `PromptParts.intent` and the trace it feeds.
  Renamed to `intent` in both `trace.ts` copies + `prompt.ts`; the DB table
  `pr_intent` and the `PrIntentRecord` API contract are a different, correctly
  -named concern (a persisted entity, not a prompt-assembly slot) and were
  left untouched.

## Tool & Library Notes

- **2026-08-24** — a Zod field in a structured-output schema (`completeStructured`,
  which routes through `openai/helpers/zod`'s `zodResponseFormat`) must use
  `.nullish()`, not bare `.optional()`, for any field the model may
  legitimately omit. OpenAI's strict structured-outputs mode requires every
  property to be present in the JSON Schema's `required` list; a bare
  `.optional()` field triggers `zodResponseFormat`'s own console warning
  ("uses `.optional()` without `.nullable()`... this will become an error in
  a future version of the SDK") and the model is expected to emit `null`
  instead of omitting the key. Caught live on `ReviewFocusItem.line`/
  `.endpoint` (`@devdigest/shared`'s `contracts/risk-brief.ts`) — fixed to
  `.nullish()`; every consumer reading the field must then use `!= null`
  (not `!== undefined`) and `?? undefined` when handing the value to a
  `T | undefined`-typed prop. `IntentExtraction`/`Risk` in `contracts/brief.ts`
  sidestep this entirely by having no optional fields at all — that's the
  simpler option when the field is never truly absent.

## Recurring Errors & Fixes

_None yet._

## Open Questions

_None yet._
