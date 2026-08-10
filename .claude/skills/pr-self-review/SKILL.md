---
name: pr-self-review
description: "Reviews the current branch's diff against every project skill scoped to the changed files (frontend-architecture, backend-onion-architecture, react-best-practices, security, zod, etc.) and blocks the PR if any grounded finding is CRITICAL. Use before running `gh pr create`, before pushing a branch meant to become a PR, or whenever asked for a 'self review' / 'review before PR' / 'ready to merge' check -- also invoked headlessly by scripts/pre-push-review.sh. This is a fast, local, deterministic gate built from this repo's own skills -- distinct from the built-in code-review skill's deep multi-agent cloud review (/code-review ultra); do not conflate the two or treat this as a replacement for it on large diffs."
version: 0.1.0
---

# PR Self Review

Applies every skill relevant to the current branch's diff and gates the PR
on CRITICAL findings. For the skill → file-glob mapping and ownership
rules, see [references/skill-scope-map.md](references/skill-scope-map.md).
For sources and rationale, see [README.md](README.md).

## Not `/code-review ultra`

`/code-review ultra` (built-in) is a deep, multi-agent, cloud-run review —
the right tool for large or high-stakes diffs. This skill is the opposite
end of the spectrum: fast, local, deterministic, and scoped to rules this
repo's own skills already state. If the diff-size guardrail (below) trips,
point the user at `/code-review ultra` instead of attempting a shallow pass.

## Procedure

Copy this checklist and track progress through it:

```
PR Self Review Progress:
- [ ] 1. Determine base branch + diff
- [ ] 2. Diff-size guardrail
- [ ] 3. Map changed files -> skills (+ staleness self-check)
- [ ] 4. No-match short circuit
- [ ] 5. Group files by skill
- [ ] 6. Review each skill's files (respect ownership + suppression)
- [ ] 7. Grounding pass
- [ ] 8. Normalize severities
- [ ] 9. Build report + gate
- [ ] 10. Emit JSON verdict block
```

**1. Base + diff.** `git fetch origin main` first (a stale local `main`
under-counts the diff). Base is `gh pr view --json baseRefName` if a PR
already exists for this branch, else `git merge-base HEAD main` (handles
stacked branches whose real base isn't `main`). Diff = everything between
that base and `HEAD`, plus uncommitted/staged changes — not just the last
commit.

**2. Diff-size guardrail.** Count changed files and lines. If it exceeds
**25 files or 1500 changed lines**, stop the full review: report which
skills *would* apply (from the map) and recommend `/code-review ultra`
instead. Don't attempt a shallow partial pass and don't silently skip this
check — say explicitly that the diff was too large for this gate.

**3. Map + staleness check.** Look up each changed file in
[references/skill-scope-map.md](references/skill-scope-map.md). Compare
the skill names in that table against the current `.claude/skills/*/SKILL.md`
listing; if they've drifted (a skill exists but isn't mapped, or vice
versa), print a warning — do not block on this, it's a maintenance signal
not a code issue.

**4. No-match short circuit.** If zero changed files match any skill in the
map (e.g. a diff touching only `.github/workflows/*.yml` or
`docker-compose.yml`), say so explicitly and verdict `ALLOW`. Don't
fabricate findings to fill space.

**5. Group by skill.** So each matched skill's `SKILL.md` (and any
`references/`/`rules/` files it points to) is read once, applied across all
its matching files in this diff.

**6. Review.** For each skill × its matching changed files: read enough of
the file for context (total line count, total prop count, etc. — not just
the raw diff hunk) and check the changed lines against that skill's rules.
Apply the **ownership rule** in the scope map so two skills don't flag the
same line under different names. Skip anything covered by a suppression
marker (see below).

**7. Grounding pass.** Before finalizing, re-check every candidate
finding's cited `file:line` actually exists in the diff under review.
Discard anything that doesn't ground. (Mirrors this repo's own
`server/src/platform/grounding.ts` — a review tool that hallucinates a
blocking finding is worse than one that reviews nothing.)

**8. Normalize severity** — see table below.

**9. Build the report + gate.** Shape it like this repo's own `Review` type
(`server/src/vendor/shared/contracts/findings.ts`): a summary, then
findings grouped by severity with file, line, the skill/rule violated, a
one-sentence rationale, and a fix suggestion. **Gate**: any CRITICAL
(post-grounding, post-normalization) → verdict `BLOCK`. Otherwise `ALLOW`,
with WARNING/SUGGESTION shown as non-blocking notes. Threshold is
configurable — read `.claude/pr-self-review.json`'s `failOn` if present
(`critical` default, matching this repo's own `ci_fail_on` default);
`ignorePaths`/`ignoreSkills` in that file exclude matches before step 3.

**10. Emit the JSON verdict block** as the LAST thing in the output —
`scripts/pre-push-review.sh` parses this, not prose:

```json
{"verdict":"BLOCK","critical":1,"warning":2,"suggestion":0,"findings":[{"file":"server/src/modules/polling/routes.ts","line":22,"skill":"backend-onion-architecture","severity":"CRITICAL","summary":"routes.ts queries container.db directly"}]}
```

On `BLOCK`: do not proceed to `gh pr create` or push. List the blocking
findings with fix suggestions and stop. On `ALLOW`: continue with what the
user asked (e.g. actually run `gh pr create`), mentioning any non-blocking
notes briefly.

## Severity normalization

| Source skill's own tag | Normalized |
|---|---|
| CRITICAL (any skill) | CRITICAL |
| HIGH | WARNING |
| MEDIUM, MEDIUM-HIGH, LOW-MEDIUM, LOW | SUGGESTION |
| No native tag (see below) | judgment call per the worked examples |

Nine skills (`backend-onion-architecture`, `drizzle-orm-patterns`,
`postgresql-table-design`, `frontend-architecture`, `fastify-best-practices`,
`next-best-practices`, `react-testing-library`, `typescript-expert`,
`mermaid-diagram`) have no native severity tags — just MUST/DO-NOT
imperatives. Calibrate with these worked examples rather than guessing
fresh each run:

| Skill | CRITICAL example | WARNING example | SUGGESTION example |
|---|---|---|---|
| backend-onion-architecture | `routes.ts` calls `container.db` directly; a multi-write path has no `db.transaction()` | new module skips the `service.ts`/`repository.ts` split but doesn't touch the DB from routes | naming a repository method inconsistently with siblings |
| drizzle-orm-patterns | missing FK index on a column used in a hot-path query; multi-step write with no transaction | N+1 query pattern in a low-traffic path | could batch a per-row loop into one multi-row upsert |
| postgresql-table-design | new nullable FK where cascade behavior is actually required; no index on a new FK column | a closed-set column left as bare `text()` instead of `text({enum:[...]})` | column naming inconsistency |
| frontend-architecture | new page.tsx with fetch/business logic inlined instead of a `_components/*View`; component created outside any of the three location tiers | new component missing the standard folder shape (no `index.ts`) | constants not colocated per convention |
| fastify-best-practices | route missing `schema.body`/`schema.params` entirely on user input | inconsistent error-handling shape vs. sibling routes | verbose route registration that could use a plugin |
| next-best-practices | `'use client'` on a component that imports from `@devdigest/ui` is *missing* (see this repo's own INSIGHTS.md incident) | unnecessary `'use client'` on a component with no interactivity | missing per-route metadata |
| react-testing-library | a whole new component ships with zero test coverage for its primary user flow | test asserts implementation detail instead of user-visible behavior | test could be consolidated per the trophy model |
| typescript-expert | `any` used to silence a real type error on new code | overly loose type widened unnecessarily | could use a narrower utility type |
| mermaid-diagram | a diagram was added with syntax that won't render | diagram doesn't follow repo's existing diagram style | minor label clarity |

## Suppression

A global bypass (`git push --no-verify`) is all-or-nothing and teaches
people to stop trusting the gate after one false positive. Prefer a narrow
suppression instead:

- Inline, at the flagged line: `// pr-self-review-ignore: <rule-id>` (e.g.
  `// pr-self-review-ignore: onion-db-in-routes`). Skip that one finding,
  not the rest of the file.
- Repo-level, for recurring false positives on a whole path: `ignorePaths`
  in `.claude/pr-self-review.json` (defaults already exclude `**/vendor/**`
  and generated files — those are do-not-touch per the skills themselves,
  so findings there are noise).

## Config

`.claude/pr-self-review.json` (optional — sane defaults apply if absent):

```json
{
  "failOn": "critical",
  "ignorePaths": ["**/vendor/**", "**/*.generated.*"],
  "ignoreSkills": []
}
```

`failOn` matches this repo's own `CiFailOn` vocabulary: `never` | `critical`
| `warning` | `any`.

## Scope

- Skills consulted: every skill in
  [references/skill-scope-map.md](references/skill-scope-map.md) whose
  glob matches a changed file. `engineering-insights` is never consulted —
  it doesn't review code.
- Does not run tests or typecheck — `TESTING.md` already documents the
  local CI-equivalent commands (`pnpm typecheck && pnpm test` per package);
  this skill's job is the qualitative rule review CI doesn't do.
- Does not replace `/code-review ultra` on large diffs (see guardrail).
