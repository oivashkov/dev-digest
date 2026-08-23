# /run-plan Skill

## Motivation

The full SDD pipeline documented in `.claude/agents/README.md` has eight
agents. Running all of them for every change is expensive — two
(`specreator`, `implementation-planner`) run on `opus` and require a human
round of clarifying questions before their output is trustworthy;
`test-writer` adds a full write-plus-run cycle on top of `implementer`'s
own. Most of the time, the spec and the plan are produced once, reviewed by
a human, and then the same plan gets executed unattended — that execution
half is what `/run-plan` automates, deliberately narrower than the full
pipeline and driven by a structured invocation
(`plan:<path> [mode:...] [max-fix:N]`) rather than free-form prompting.

## Decisions and why

- **`specreator` and `implementation-planner` excluded entirely.** Both are
  `opus` and both require a human round of clarifying questions/approval
  before their output is trustworthy — folding them into an unattended
  skill would either force it to guess at answers a human should give, or
  keep stopping and resuming, which running them manually first already
  does more simply. Confirmed with the user 2026-08-23.
- **`test-writer` skipped entirely, not deferred to a flag.** Cost-saving
  policy, confirmed with the user 2026-08-23. The final report is explicit
  about this specifically so a missing test-writer pass never gets silently
  read as "coverage exists" — `plan-verifier`'s matrix will show
  `Missing`/`Partial` on test-related plan items as a direct, expected
  consequence, every round, for the life of the run.
- **`architecture-reviewer` and `plan-verifier` needed no model change.**
  Both are already `model: sonnet` in their own frontmatter — the cost
  concern that prompted this skill (opus spend) was already fully addressed
  by excluding `specreator`/`implementation-planner`, not by touching these
  two.
- **`plan-verifier` runs in parallel with `architecture-reviewer` from round
  0, and again after every fix round — but never drives the fix loop
  itself.** Revised 2026-08-23 after the user's own sketch of this skill
  showed both running together, not `plan-verifier` gated separately or
  deferred to a single final pass (an earlier draft of this skill tried the
  cheaper single-final-pass variant; superseded). Only
  `architecture-reviewer`'s Critical findings are auto-routed to
  `implementer` (confirmed the same day, re-affirmed against the
  alternative of also feeding it `plan-verifier`'s Missing/Partial) —
  because `test-writer` is never run here, a coverage-shaped Missing item is
  structurally unfixable by this loop; feeding it in would either loop
  forever chasing a gap it cannot close, or quietly have `implementer` write
  ad hoc tests, defeating the point of skipping `test-writer` for cost.
  `plan-verifier` still runs every round purely so the final report reflects
  current, not stale, traceability.
- **Fix loop capped at `max-fix`, default 3** (raised from an initial
  default of 2, confirmed with the user 2026-08-23 to match their own
  sketch). Overridable per invocation (`max-fix:N`) without editing this
  file. A Critical still open after the cap surfaces to the user instead of
  looping indefinitely.
- **`architecture-reviewer` is always scoped to the changed-file list, never
  a module.** Same rule lives in `architecture-reviewer.md` §0 itself — this
  skill is the concrete implementation of that rule, not a separate policy.
- **Structured invocation (`plan:` / `mode:` / `max-fix:`) instead of a
  free-form prompt.** Matches the user's own drafted call shape for this
  skill — `mode:` and `max-fix:` are explicit overrides of what the plan
  file and the default already state, so a run's exact parameters are
  visible in the invocation itself, not buried in prose.

## Not a replacement for `pr-self-review`

This skill ends with a report and a pointer to `pr-self-review`. It does
not run it, does not commit, and does not open a PR — per `AGENTS.md`,
`pr-self-review` (or `scripts/pre-push-review.sh`) is still a separate,
required step before a branch becomes a PR.
