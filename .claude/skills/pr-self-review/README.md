# PR Self Review Skill

## Motivation

DevDigest has 13 rule-bearing skills but nothing that *applies* them
automatically to a diff — a developer (or Claude) has to remember which
skills are relevant and invoke them manually before opening a PR. This
skill closes that loop: map the current branch's changed files to the
skills that actually govern them, review against those rules, and refuse
to let a PR go out if a CRITICAL finding survives.

It's deliberately not a second `/code-review ultra` (the built-in deep
multi-agent cloud review) — it's the fast, local, deterministic
counterpart: this repo's own skills, applied mechanically, gated the same
way this repo's own reviewer engine gates a PR it reviews for someone else.
That's also the thematic point: DevDigest is an AI PR-review product,
building a self-review skill for its own repo using its own domain
vocabulary.

Because a skill is just a markdown instruction Claude loads, it can't
intercept `git push`/`gh pr create` outside a Claude Code session on its
own. Real enforcement (the "runs before every PR opens on GitHub" half of
the requirement) comes from `scripts/pre-push-review.sh`, a versioned git
`pre-push` hook that shells into `claude -p` headless mode and parses this
skill's JSON verdict.

## Sources

### Internal (primary — this skill's vocabulary and gate logic come from here)

- `reviewer-core/src/output/to-review.ts` — `SEV_RANK`, `FAIL_ON_MIN_RANK`,
  `gateTriggered()`, `countBlockers()`. The exact rank-based gating pattern
  this skill's "block on CRITICAL" rule mirrors, down to the vocabulary.
  DevDigest's own review engine explicitly does **not** trust an LLM's
  self-reported verdict/score for gating — findings' severities plus a
  policy threshold decide, deterministically. This skill follows the same
  principle: the JSON verdict is derived from graded, grounded findings,
  not from an unstructured "looks fine to me."
- `server/src/vendor/shared/contracts/findings.ts` — `Severity = CRITICAL |
  WARNING | SUGGESTION`, the `Finding`/`Review` shape this skill's report
  format mirrors.
- `server/src/vendor/shared/contracts/knowledge.ts` — `CiFailOn = never |
  critical | warning | any`, the vocabulary `.claude/pr-self-review.json`'s
  `failOn` reuses directly.
- `server/src/platform/grounding.ts` — the "don't trust an ungrounded
  finding" concept this skill's step 7 (grounding pass) borrows: a
  hallucinated CRITICAL must never be able to block a real push.
- `TESTING.md` — documents the local CI-equivalent commands this skill
  deliberately does not reimplement (`pnpm typecheck && pnpm test` per
  package); this skill's value-add is the qualitative rule review CI
  doesn't do, not a second test runner.
- `client/INSIGHTS.md`'s 2026-08-10 entry (the `not-found.tsx` /
  `@devdigest/ui` RSC-crash incident) — the direct real-world source for
  the next-best-practices CRITICAL worked example in `SKILL.md`.
- This session's full skill-catalog audit (severity vocabularies, file
  scopes, ownership overlaps, dangling cross-references) — the basis for
  [references/skill-scope-map.md](references/skill-scope-map.md).

### Meta: how this skill itself was authored

- [Anthropic — Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
  — same conventions applied to `frontend-architecture`/
  `backend-onion-architecture`: third-person what+when description,
  workflow checklist pattern for a genuinely multi-step procedure,
  progressive disclosure (the large scope-map table lives in
  `references/`, not inline).

## Version

**0.1.0** (2026-08-10) — initial version. Severity normalization,
worked-example heuristics for the 9 untagged skills, and the file-scope map
are all first-pass judgment calls, not yet validated against real usage.
Expect the scope map to need updates whenever a skill is added/rescoped,
and the severity heuristics to need tightening once real false
positives/negatives show up — that's what the suppression mechanism and
warn-first hook rollout are for.
