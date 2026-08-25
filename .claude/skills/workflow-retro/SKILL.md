---
name: workflow-retro
description: >-
  Manually-invoked retro over a multi-agent workflow that already ran in this
  conversation (a spec-creator session, a /run-plan execution, or any sequence
  of Agent/subagent calls) — never auto-triggered. Reconstructs the
  agent-invocation timeline and order, approximates token cost per agent and
  for the orchestrating thread, counts human-in-the-loop cost
  (AskUserQuestion rounds, how often the recommended option was accepted vs.
  overridden), counts post-agent manual rework (edits made to an agent's own
  artifact after it reported done), and pulls each agent's self-reported
  friction (what it flagged as hard, skipped, unresolved, or duplicated)
  straight from its own final report. Every analytics section is paired with
  its own concrete Recommendations — this is not analytics-only. Use for
  "/workflow-retro", "retro this workflow", "how did the agents do", "review
  this run", or any explicit request to evaluate a multi-agent workflow's own
  performance after it finished. Does not spawn agents, does not edit code or
  specs, does not grade with an invented numeric score, and never runs
  automatically — invocation is manual only, confirmed with the user
  2026-08-23.
version: 0.1.0
---

# /workflow-retro

A retro over *how the workflow ran*, not over what it produced —
`architecture-reviewer`, `plan-verifier`, and `pr-self-review` already own
judging the output. This skill looks at the conversation that just happened:
which agents ran, in what order, at what token cost, how many rounds of
human clarification it took, how much rework the orchestrator did to an
agent's handoff afterward, and what each agent itself flagged as hard, easy,
skipped, or duplicated. Every metric section produces a paired
recommendation — a report that is all counts and no next action is an
incomplete run of this skill, not a lean one.

## Invocation

```
/workflow-retro [scope:<description>]
```

- **Manual only.** This never fires at the end of a task or session on its
  own — the user calls it by hand, confirmed 2026-08-23. Do not offer to
  "run this automatically next time"; that is a different feature, not this
  skill's job.
- **`scope:`** optional. Defaults to the entire current conversation. Narrow
  it with a short description ("just the run-plan part", "since the last
  retro") when the conversation visibly contains more than one distinct
  workflow — see §0.

## What this is not

- **Not a numeric score.** No "8/10", no invented composite index — every
  claim in the report traces to a concrete count, quote, or `file:line`.
  Fabricated-looking numbers that trace to nothing are exactly the failure
  mode root `INSIGHTS.md` (2026-08-12) already warns about for skill stats;
  this skill does not repeat it for workflows.
- **Not a code, architecture, or spec review.** `architecture-reviewer`,
  `plan-verifier`, and `pr-self-review` judge the artifact; this judges the
  process that produced it.
- **Not a replacement for `engineering-insights`.** It feeds that skill,
  once, with whatever survives the exact same gate (§8) — it does not get a
  looser bar for being a retro.
- **Not a live-monitoring or auto-triggered skill.** It only ever looks
  backward at a workflow that has already finished.

## Procedure

```
Workflow Retro Progress:
- [ ] 0. Resolve scope
- [ ] 1. Reconstruct the agent-invocation timeline
- [ ] 2. Approximate token cost (and say plainly that it is approximate)
- [ ] 3. Measure human-in-the-loop cost
- [ ] 4. Measure post-agent rework
- [ ] 5. Extract per-agent self-reported friction
- [ ] 6. Detect duplicated / wasted effort
- [ ] 7. Write the Retro Report — analytics paired with recommendations
- [ ] 8. Record durable findings via engineering-insights (conditional)
```

### 0. Resolve scope

Default: the whole current conversation. If `scope:` was given, or the
conversation visibly contains more than one distinct workflow (e.g. a spec
session followed later, in the same conversation, by an unrelated
`/run-plan` run), ask which stretch the user means before proceeding —
don't guess which agents belong to "the workflow" being retro'd.

### 1. Reconstruct the agent-invocation timeline

Walk the conversation **in order** and list every `Agent` tool call: its
`subagent_type`, `description`, any `model`/`isolation` override, and
whether it ran to completion, was superseded, or is still pending. This
transcript walk is the only reliable source for "who ran, and in what
order" — never infer the timeline from an agent's own report describing
itself, since a report can omit what it decided not to do.

### 2. Approximate token cost — and say plainly that it's approximate

- **Per agent.** Every agent completion (a direct return, or a
  `task-notification` for a backgrounded one) carries a `<usage>` block —
  `subagent_tokens`, `tool_uses`, `duration_ms`. Sum these per agent and
  overall. This is the agent's own reported figure, not an inference.
- **Orchestrator thread.** System reminders carry
  `<total_tokens>N tokens left</total_tokens>` against this session's fixed
  budget. Diff the earliest visible value against the latest to approximate
  what the orchestrating thread itself burned on reasoning and tool calls
  not delegated to a subagent. Name the two raw numbers you diffed in the
  report — never print only the delta with no source shown.
- **State the caveat once, visibly, in the report itself:** prompt caching,
  context summarization, and reused system prompts mean this is a
  directional number for comparing agents/runs against each other, not an
  auditable bill. Do not present it as exact cost.

### 3. Measure human-in-the-loop cost

Count every `AskUserQuestion` call in scope: how many rounds, how many
questions per round, and for each question whether the user picked the
option marked "(Recommended)", a different option, or supplied free-text
"Other". **A high override/"Other" rate on a question is itself a finding**
— it means the offered options were miscalibrated against what the user
actually wanted, not that the user is indecisive. Note it as such in §7's
recommendations rather than only as a raw count.

### 4. Measure post-agent rework

For each agent that produced a durable artifact (a file it wrote or
edited), count the `Edit`/`Write` calls the **orchestrator itself** made to
that same artifact *after* the agent reported done, and characterize each
batch in one clause (e.g. "resolved Q2 per the user's scoping decision",
"corrected an internal inconsistency the agent's own report had already
flagged"). A high rework count right after handoff is a signal the agent
under-resolved before reporting done — but not automatically a mark
against it if the rework was answering questions the agent explicitly and
correctly left open (cross-check against §5's self-reported open
questions before calling it friction).

### 5. Extract per-agent self-reported friction

Re-read each agent's final report for its own signals — most of this
repo's agents already structure them, so extract rather than infer:

- "Open questions" / "Self-verification — failures found and fixed" /
  "Skipped: …" lines — **quote them**, don't paraphrase into something
  vaguer than what the agent actually said.
- Anything the agent explicitly flagged as **not performed**, and why.
- Whether the agent needed a clarifying round with the user before starting
  (e.g. `spec-creator` §0, `implementation-planner`'s mode confirmation) vs.
  proceeded straight through. A session with **zero** clarifying rounds on
  a genuinely ambiguous ask is worth flagging too — the failure mode runs
  in both directions, not just "too many questions".

### 6. Detect duplicated / wasted effort

Look for concrete repetition, not a vibe — every entry here needs a
specific instance, not a general impression:

- The same file grounded/read by more than one participant in the same
  workflow that could have been supplied once (e.g. the orchestrator
  reading a README right before handing an agent a prompt that then tells
  the agent to go read that same README itself).
- Non-text design context (screenshots, diagrams) manually transcribed into
  an agent's prompt because the subagent has no vision of its own — flag
  this as a **systemic, repeatable** cost across every such workflow in
  this project, not a one-off, since it recurs by construction whenever a
  vision-only subagent is used.
- Two agents in the same run independently arriving at the same grounding
  fact or the same open question — a sign the second agent's prompt could
  have been given the first agent's finding directly instead of
  re-deriving it.

### 7. Write the Retro Report

Use the template below. Every analytics section is immediately followed by
its own paired **Recommendations** subsection — never emit a section that
is all numbers with no next action attached to it.

### 8. Record durable findings via `engineering-insights` (conditional)

Run the exact gate that skill already defines (its §2a: judge by feel, cap
at 3 entries, dedup-check before writing) against whatever surfaced in §5/
§6 — this skill does not get a looser bar for being a retro. Most retros
will surface zero or one entry, not three; "nothing worth recording" is a
perfectly fine outcome here too. File under whichever module the workflow
touched, or root `INSIGHTS.md` for a cross-package workflow, using the same
module-resolution table `engineering-insights` already defines.

## Report template

```markdown
# Workflow Retro: <one-line label for the workflow>

## Timeline
| # | Agent | subagent_type | Trigger | Outcome |
|---|---|---|---|---|

## Token cost (approximate — see caveat below)
- Per agent: <name> ≈ N tokens (<tool_uses> tool calls, <duration>)
- Orchestrator thread: ≈ (start_left − end_left) tokens (<start> → <end>)
- Total ≈ N
- Caveat: directional only — caching/summarization make this non-auditable.

**Recommendations**
- <e.g. "agent X's cost was dominated by N redundant Read calls on files the
  orchestrator's own prompt already quoted verbatim — inline the excerpt
  next time instead of just the path">

## Human-in-the-loop cost
- N rounds, M questions total
- Recommended-option acceptance: X/M
- Non-recommended / "Other" answers: <which questions, what changed>

**Recommendations**
- <e.g. "question Q11 had to be re-asked because neither option matched
  what the user meant — split compound questions instead of bundling a
  scope confirmation with a category choice">

## Post-agent rework
- <agent> — N edits after handoff: <one clause each>

**Recommendations**
- <e.g. "fold this scoping question into the agent's own clarify-first
  round instead of surfacing it only as an Open question, since it blocked
  downstream design either way">

## Per-agent friction (self-reported)
### <agent>
- Easy: <quote or concrete claim from its own report>
- Hard / iterated: <quote or concrete claim>
- Flagged as skipped or left unresolved: <quote>

## Duplicated / wasted effort
- <concrete instance — file:line, or the exact repeated content/action>

**Recommendations**
- <e.g. "screenshots got hand-transcribed into the agent prompt on every
  run — worth a shared scratch file vision-capable turns can write once and
  every subsequent agent reads instead">

## Recorded to INSIGHTS.md
- <file> — <one line>, or "nothing recorded this retro"

## Overall recommendations for next run
<3–6 bullets, ranked highest-impact first, concrete enough to act on
without re-deriving anything — never "communicate better" or other advice
that is true of every workflow and therefore useful for none of them>
```

## Scope boundaries

This skill must NOT:

- Spawn any subagent — it only reads what already happened in this
  conversation and the repo's own reports; it never re-runs or verifies the
  workflow's output itself.
- Edit code, specs, or plans. Findings go into the report and, gated, into
  `INSIGHTS.md` — nothing else.
- Invent a numeric score, grade, or letter rating for the workflow.
- Auto-trigger, or suggest wiring itself to trigger automatically — it runs
  only on explicit invocation, always.
- Present its token/cost numbers as exact billing — always carry the §2
  approximation caveat into the report.
- Skip the Recommendations pairing on any analytics section — an
  analytics-only report fails this skill's own bar, not just a style
  preference.
