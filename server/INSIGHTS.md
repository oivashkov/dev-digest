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

## What Works

_None yet._

## What Doesn't Work

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

_None yet._
