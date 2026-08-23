# /workflow-retro Skill

## Motivation

This repo already runs several multi-agent workflows — a `specreator`
session with a round of `AskUserQuestion` clarifications, a `/run-plan`
execution spanning `implementer` → `architecture-reviewer` ‖
`plan-verifier` → a bounded fix loop, or any ad hoc chain of `Agent` calls.
None of them look back at *themselves*: how many tokens the whole thing
cost, how many rounds of human clarification it actually took, how much
manual rework the orchestrator did to an agent's handoff right after the
agent reported "done", and what each agent itself flagged as hard, easy,
skipped, or duplicated. That gap is what `/workflow-retro` closes — a
retro over the *process*, distinct from `architecture-reviewer` /
`plan-verifier` / `pr-self-review`, which all judge the *artifact*.

Concrete case that motivated writing it: the `specreator` session that
produced `specs/01-project-context.md` — one `opus` agent, ~152k
subagent tokens, four rounds of `AskUserQuestion` (11 questions total,
about half accepted the recommended option, several needed a follow-up
re-ask), and roughly a dozen orchestrator `Edit` calls made *after* the
agent's own report to write the user's resolutions of its 13 self-flagged
open questions into the file. All of that was visible in the conversation
already — nothing new needed to be logged for it — but nothing pulled it
together into a report with next-run recommendations until this skill
existed.

## Decisions and why

- **Manual invocation only, never auto-triggered.** Confirmed with the user
  2026-08-23 — `/workflow-retro` is not wired to fire at the end of a
  workflow or session on its own. An automatic version is a materially
  different feature (it would need a firm definition of "workflow
  boundary" and a place to persist output between sessions); this version
  is the person-driven one.
- **Analytics sections must be paired with Recommendations, not
  analytics-only.** Confirmed with the user 2026-08-23, after an initial
  sketch of this skill covered only metrics (tokens, agent count/order,
  self-reported friction). A retro that only counts things without saying
  what to change next run does not close the loop it exists to close.
- **No invented numeric score.** Consistent with this repo's own rejected
  pattern for skill stats — root `INSIGHTS.md` (2026-08-12) already flags
  fabricated placeholder numbers as "look real, trace to nothing"; this
  skill holds itself to the same bar and reports concrete counts/quotes
  instead of a synthesized rating.
- **Token accounting is explicitly approximate, not audited.** The only
  signals available inside a conversation are each agent's own `<usage>`
  block and the orchestrator's `<total_tokens>N left</total_tokens>`
  reminders diffed start-to-end. Both are real, reported numbers — but
  caching and context summarization mean neither adds up to an exact bill,
  so the report says so rather than implying more precision than it has.
- **Reuses `engineering-insights`' own gate for anything durable, at the
  same bar — no separate, looser threshold.** A retro is exactly the kind
  of session that tempts writing three vague entries because "a lot
  happened"; the existing read-first/record-last skill's cap-at-3 and
  dedup-check apply here unchanged.
- **Does not spawn agents and does not re-verify the workflow's output.**
  That is `architecture-reviewer` / `plan-verifier` / `pr-self-review`'s
  job on the artifact side; this skill only reads what already happened
  and reports on the process.

## Not a replacement for `engineering-insights`

This skill's §8 explicitly runs `engineering-insights`' own procedure
against whatever the retro surfaces — it does not maintain its own
insights log or its own bar for what's worth recording. If a retro finds
nothing durable, "nothing recorded" is the expected, correct outcome, same
as for that skill.
