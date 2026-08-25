---
name: run-plan
description: >-
  Executes an already-written Development Plan end to end, fully autonomously
  (the plan was already agreed by a human — see "Not this skill's job"
  below). Invocation: `/run-plan plan:<path> [mode:single|multi]
  [max-fix:N]`. Spawns `implementer` instance(s) per the plan's DAG/Owned
  paths (or the confirmed single-agent mode), runs `architecture-reviewer`
  and `plan-verifier` in parallel (both read-only) against what changed,
  then runs a bounded fix loop (default 3 rounds, override via `max-fix:`)
  that routes only architecture-reviewer's Critical findings back to the
  owning `implementer` instance and re-reviews with both agents again after
  each round. Ends with a report and a pointer to `pr-self-review` — never
  pushes. Use for "/run-plan", "run the plan", "execute <path>/plan.md", or
  any request to carry out a plan file that already exists. Does NOT invoke
  `spec-creator`, `implementation-planner` (run those manually first — this
  skill only consumes their output), or `test-writer` (skipped by policy to
  save cost; run it manually afterward for coverage).
version: 0.2.0
---

# /run-plan

Runs the execution half of this repo's SDD pipeline
(`.claude/agents/README.md`) against a Development Plan that already
exists and was already agreed by a human. It never writes the plan itself
and never decides what the feature should do.

## Invocation

```
/run-plan plan:<path> [mode:single|multi] [max-fix:N]
```

- **`plan:<path>`** — required. Path to the Development Plan file (e.g.
  `plan:server/specs/23-agents-limit-plan.md`). No plan path, no run — do
  not search for "the most recent plan" and guess.
- **`mode:single|multi`** — optional. Overrides the plan's own stated
  **Execution mode** (§6 of `implementation-planner`'s output format). If
  omitted, use what the plan already states. If the plan states none and no
  override was given either, ask before spawning anything — this decides
  whether steps run in parallel.
- **`max-fix:N`** — optional, default **3**. Caps the fix loop (§6) at N
  rounds. A Critical finding still open after round N goes to the final
  report for the user, not into round N+1.

If the request only carries a feature description, a prompt, or design
sources and no plan file — stop and say this needs `spec-creator` +
`implementation-planner` first; do not attempt to invent a plan yourself.

## Not this skill's job

| Stage | Run here? | Why |
|---|---|---|
| `spec-creator` (write spec) | **No** | Manual, separate, before a plan exists. |
| `implementation-planner` (write plan) | **No** | Manual, separate — this skill only consumes its output, never produces it. |
| `implementer` | Yes | The code-writing stage. |
| `architecture-reviewer` | Yes | Every round: initial + each fix round. |
| `plan-verifier` | Yes | Every round, **in parallel** with `architecture-reviewer` — for visibility, not as a fix trigger (see §6). |
| Fix loop → `implementer` | Yes | **Critical from `architecture-reviewer` only.** `plan-verifier`'s Missing/Partial never auto-triggers a fix, at any round. |
| `test-writer` | **No — skipped by policy.** | Cost-saving decision, confirmed with the user 2026-08-23. Say so plainly in the final report. |
| `doc-writer`, commit, push, PR | **No** | Out of scope. Final report points at `pr-self-review` as the next manual step. |

## Procedure

Copy this checklist and track progress through it:

```
Run Plan Progress:
- [ ] 0. Parse invocation args, resolve plan + execution mode
- [ ] 1. Capture baseline (pre-existing working-tree state)
- [ ] 2. Spawn implementer(s) per execution mode / DAG
- [ ] 3. Check for blocked/deviated steps before proceeding
- [ ] 4. Compute the cumulative changed-file list
- [ ] 5. Round 0 — architecture-reviewer ‖ plan-verifier, in parallel
- [ ] 6. Fix loop — Critical (architecture-reviewer) only, capped at max-fix
- [ ] 7. Final report — implemented / fixed / residual / verdict / NOT done
```

### 0. Parse invocation args, resolve plan + execution mode

Parse `plan:`, `mode:`, `max-fix:` from the invocation per §"Invocation"
above. Read the plan file; extract every step's number, title, Type, Owned
paths, Depends-on, and "Tests to run/add" line, plus the plan's stated
Execution mode (unless `mode:` overrides it).

### 1. Capture baseline

Before spawning anything, run `git status --porcelain` and `git diff --stat`
to record the working tree's state — this is what §4 diffs against, so
`architecture-reviewer` reviews only what this run touched, never the whole
module (per `architecture-reviewer.md` §0's pipeline note).

### 2. Spawn implementer(s)

- **`mode:single`**: one `Agent` call, `subagent_type: implementer`, given
  the plan path, running every step in order itself.
- **`mode:multi`**: group steps by dependency. Steps with no unresolved
  `Depends on` and disjoint Owned paths get one `Agent` call each, **issued
  together in the same response** so they run in parallel — pass each
  instance the plan path and its specific step number (it reads the plan
  file itself; don't duplicate the plan text into every prompt). A step
  with a `Depends on` waits until that dependency's instance finishes.
- **Record the returned agent name/id for every instance**, keyed by its
  Owned paths — §6's fix loop `SendMessage`s back into the *same* instance
  (context intact), never a blind new one.

### 3. Check for blocked/deviated steps

Read every implementer's "Deviations from plan" section. If any step
reports a blocking deviation (refused an out-of-Owned-paths edit, an unmet
`Depends on`, a contradicted plan item): stop here — do not proceed to
§5/§6 on known-incomplete work — and report the deviation as the final
output instead.

### 4. Compute the cumulative changed-file list

`git diff --name-only` (plus `git status --porcelain` for new untracked
files) against the §1 baseline. This explicit list — never "the module" —
is what `architecture-reviewer` gets as its target, every round.

### 5. Round 0 — architecture-reviewer ‖ plan-verifier, in parallel

Issue both `Agent` calls **together in the same response**:

- `subagent_type: architecture-reviewer`, target = the §4 file list.
- `subagent_type: plan-verifier`, given the plan path, checked against the
  current working tree.

Both are read-only — running them together costs no more than running them
one after another, just faster wall-clock, and neither can conflict with
the other's output.

**Read `plan-verifier`'s result for visibility only at this stage** — its
Missing/Partial items (most commonly the "Tests to run/add" ones, expected
since `test-writer` never runs here) get carried into the final report,
never fed into §6's fix loop.

### 6. Fix loop — Critical only, capped at `max-fix`

Only **Critical** findings from `architecture-reviewer` are auto-routed
back for a fix. Warning/Suggestion from `architecture-reviewer`, and every
`plan-verifier` Missing/Partial, go straight to the final report for the
user to triage — never trigger a re-spawn, at any round.

For round `1..max-fix`, while unresolved Criticals remain:

1. For each open Critical, match its `file:line` to the step whose Owned
   paths cover that file.
   - **No matching step**: do not auto-route. Carry it into the final
     report as "Critical, unrouted — needs manual decision."
2. `SendMessage` to that step's implementer instance (by the name/id from
   §2) with the finding's typology, `file:line`, evidence, and violated
   rule — instruct it to fix only within its own Owned paths and report
   back what changed.
3. Once every routable Critical for this round has a fix reported,
   recompute §4's changed-file list and re-run **both**
   `architecture-reviewer` and `plan-verifier` again, in parallel, exactly
   as in §5 — this is what keeps `plan-verifier`'s picture current for the
   final report even though it never drives the loop itself.
4. If no Critical remains, stop the loop (success — proceed to §7 early).
   If Criticals remain and `round == max-fix`, stop the loop (cap reached)
   and carry the residual Criticals into §7 for the user to decide. Never
   run a `max-fix + 1`th round.

### 7. Final report

Synthesize — do not paste each subagent's full report verbatim:

```markdown
# Run Plan: <plan title>

## Steps executed
| Step | Instance | Result |
|---|---|---|

## Architecture review
- Round 0 Critical findings: <n>
- Fix rounds run: <0..max-fix>
- Resolved: <list, file:line>
- Residual Critical (cap reached, or unrouted): <list, or "none">
- Warning/Suggestion (never auto-fixed — for the user): <list, or "none">

## Plan verification (tracked every round, never drove the fix loop)
- Final coverage: D/P/M/S per plan-verifier's matrix
- Test-related items showing Missing/Partial: expected — `test-writer` was
  not run in this skill (see below)

## Explicitly NOT performed
- **test-writer** — skipped by this skill's cost policy. Run it manually
  before merging if coverage is required.
- **spec-creator / implementation-planner** — out of scope; this skill only
  consumed an existing plan.
- **doc-writer** — not run.
- **No commit, push, or PR.**

## Next step
Run `pr-self-review` before opening a PR (per `AGENTS.md`) — this skill
does not gate on it itself.

## Follow-ups
- <anything the fix-loop cap left open, anything unrouted, anything the
  user should decide>
```

## Scope boundaries

This skill must NOT:

- Invent or amend a Development Plan — it consumes one, verbatim, and stops
  if none is given.
- Invoke `spec-creator`, `implementation-planner`, `test-writer`, or
  `doc-writer`.
- Auto-route a Warning/Suggestion finding, or any `plan-verifier`
  Missing/Partial item, into the fix loop — Critical from
  `architecture-reviewer` only, at every round.
- Run more than `max-fix` fix rounds — a Critical still open after that
  goes to the user, not into another round.
- Let `architecture-reviewer` default to reviewing a whole module — always
  hand it the explicit changed-file list from §4.
- Commit, push, or open a PR.
