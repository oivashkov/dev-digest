# reviewer-core/docs

How the engine works today. Deep dives too long for `README.md`.

Good candidates: the grounding heuristics and exactly which findings get
dropped, deterministic score recomputation, prompt slot ordering and token
budget, `parseWithRepair` failure modes, the injection-fencing rules, the
map-reduce path.

Not here: the pipeline diagram and public API (that is `../README.md`), intent
for unbuilt slots (`../specs/`), rejected approaches (`../INSIGHTS.md`).

Built-in agent system prompts live in `../docs/agent-prompts/` at repo root —
link, do not copy.

## `classifyIntent`'s own prompt construction

`review/intent.ts`'s `classifyIntent` does **not** go through `assemblePrompt`
or reuse `prompt.ts`'s `INJECTION_GUARD` — see `../README.md` for why it is a
separate entry point rather than a pipeline stage. Its prompt construction is
smaller and self-contained:

- **One system message**, built from a fixed `SYSTEM_PROMPT` (states the task:
  infer intent/scope from whichever signals are present, preferring plan/spec
  or ticket over description, description over the diff-stat fallback; and the
  exact three-field output shape — `intent`, `in_scope`, `out_of_scope` —
  explicitly forbidding a `confidence` field) concatenated with its own
  `INTENT_INJECTION_NOTE`, a shorter injection-defense paragraph scoped to this
  classification framing rather than `INJECTION_GUARD`'s diff-centric one.
- **One user message**, assembled from whichever optional sections are
  non-empty, each independently `wrapUntrusted()`-fenced with its own tag: PR
  title (`pr-title`, always present), PR description (`pr-description`, only
  if non-empty), linked ticket (`linked-ticket`, title+body joined), plan/spec
  excerpts (one `wrapUntrusted()` call per excerpt, tagged `plan:<path>` so the
  model can distinguish multiple referenced documents), and the diff-stat
  fallback (`diff-stat`) — omitted whenever any stronger signal exists. Section
  order in the user message mirrors this list, not alphabetical or arbitrary.
- The call itself is a single `input.llm.completeStructured<IntentExtraction>`
  against the caller-supplied `model` (never hardcoded — the caller resolves it
  via `FEATURE_MODELS`'s `review_intent` entry), with the same
  parse-with-repair retry budget mechanism (`DEFAULT_INTENT_MAX_RETRIES = 2`)
  as the main review path, plus an optional `timeoutMs` the caller uses to keep
  this best-effort pre-step from stalling a review batch.

No confidence is ever requested from the model here — it is assigned
deterministically by the caller (`server/src/modules/reviews/intent.ts`'s
`tierFor()`), the same "never trust a self-report" principle as the grounding
gate's score recomputation (see `../INSIGHTS.md`, "Mechanical grounding gate").
