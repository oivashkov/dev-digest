# TODO

Future work, not scheduled into any course lesson. No implementation has
started on any item below.

---

## GitLab support (alongside GitHub)

**Status:** implemented 2026-08-04 (server + client), all suites green. See
`docs/plans/gitlab-connector.md` for the full staged plan with every file
path (kept out of this file to stay scannable). Remaining follow-ups: the
"Remaining risks / open questions" list below — none block normal use, but
the clone-auth convention (#1) and discussion/comment mapping (#2) are
best-effort against gitbeaker's typed API surface, not verified against a
live GitLab instance yet.

**2026-08-05 follow-up shipped:** self-hosted GitLab instances often carry a
self-signed or expired cert (real user report — PR sync failed with
`certificate has expired`). Added a per-repo "skip TLS validation" option
(`insecure_tls`, Advanced disclosure on Add Repository, off by default,
scoped to that repo's connections only). See
`docs/plans/insecure-tls.md` — includes a post-ship incident where the fix
itself broke from an unrelated `undici` major-version mismatch against
Node's bundled fetch implementation, now resolved and pinned.

**Goal:** import a repo from GitLab — gitlab.com **or self-hosted** — in
addition to GitHub, with full method parity to the GitHub adapter, while
GitHub's existing behavior, adapter, and tests are untouched.

### Why this is feasible

GitHub access already sits behind a proper port, not a concrete class:

- `GitHubClient` interface — `server/src/vendor/shared/adapters.ts:143-167`
- Implementation — `OctokitGitHubClient` (`server/src/adapters/github/octokit.ts`)
- Mock for tests — `MockGitHubClient` (`server/src/adapters/mocks.ts:130-240`)
- DI wiring — `Container.github()` in `server/src/platform/container.ts:153-160`

Same adapter/DI pattern used for the LLM and git adapters elsewhere in
`server/`, so a second provider is additive. Confirmed by reading
`reviews/run-executor.ts` and `reviews/diff-loader.ts` in full:
**`reviewer-core` and the diff pipeline need zero changes** — diffs come from
the local clone (`GitClient`/simple-git) or persisted `pr_files`, never from
`GitHubClient` directly.

### Decisions (confirmed with the user — not open questions anymore)

- **Self-hosted GitLab is in scope for V1**, not gitlab.com-only. No new
  global "instance URL" setting needed: the host comes from whatever URL the
  user pastes into "Add repository" (`parseRepoUrl` grows a generic
  any-non-github-host branch), stored per repo. V1 assumes any non-github.com
  git remote is GitLab-API-compatible — a real limitation, not silently
  bulletproof (see Risks).
- **Full 10-method parity in the GitLab adapter**, including the 4 methods no
  route calls today (`openPullRequest`, `commitFiles`, `findOpenPr`,
  `getIssue` — they back a not-yet-wired "auto-fix" feature). Not stubbed.
- **REST via `@gitbeaker/rest`**, mirroring `OctokitGitHubClient`'s
  thin-wrapper-per-method style 1:1.
- **`GitHubClient` stays untouched.** A parallel `GitLabClient` interface
  (same 10 method signatures) plus a narrow `VcsClient` structural type for
  what routes actually call (`listPullRequests`, `getPullRequest`,
  `listReviewComments`, `createReviewComment`, `currentLogin`, `postReview`).
  `Container.github()`'s signature/behavior don't change; a new
  `Container.gitlab(host)` (cached per host, since a workspace could
  reference more than one self-hosted instance) and `Container.vcsFor(repo)`
  are additive.
- **`repos` table gains two columns**, not one: `provider` (`github|gitlab`,
  default `'github'`) and `host` (default `'github.com'`) — both defaulted,
  so existing rows need no data migration.
- **No PR/MR terminology change.** GitLab MRs map onto the existing
  `PrMeta`/`PrDetail` shape in the adapter's mapping layer (`iid`→`number`,
  `source_branch`→`branch`, `target_branch`→`base`).

### What was confirmed already generic (less work than first assumed)

- Server settings (`settings/routes.ts:42`, `settings/constants.ts`
  `SECRET_KEY_BY_PROVIDER`) already iterate providers generically — adding
  `gitlab` to `ConnTestProvider` and one map entry is enough; TypeScript's
  exhaustiveness check forces the map entry.
- Client Settings API-keys panel
  (`SettingsApiKeys/constants.ts` → `KEY_ROWS`) is a plain declarative array —
  adding GitLab is a one-line addition + 2 i18n keys, not a component rewrite.

### Remaining risks / open questions (implementation-time, not blocking)

1. GitLab's PAT-over-HTTPS clone-auth convention (`oauth2:<token>@host`,
   likely — different from GitHub's `x-access-token:<token>@host`) needs
   verification against a real GitLab instance before shipping; wrong = silent
   private-clone auth failures.
2. GitLab discussions (position object, `discussion_id` threads) may not map
   1:1 onto `PrReviewComment`'s GitHub-shaped `side`/`in_reply_to_id` fields —
   resolve against `@gitbeaker/rest`'s real response shape, not guessed.
3. One global `GITLAB_TOKEN` is assumed to work across every GitLab host a
   workspace references — a workspace mixing gitlab.com + self-hosted (with
   different PATs) isn't supported in V1.
4. No way to distinguish a real self-hosted GitLab remote from some other
   non-GitHub git host by URL shape alone (the D2 assumption) — should fail
   loudly, not silently, when the API calls don't behave like GitLab.
5. Settings "test connection" for a self-hosted token needs a host input
   somewhere, since there's no repo row to read a host from before any GitLab
   repo has been added.
6. `@gitbeaker/rest` version/method-surface not yet verified against the live
   package (no network access during planning).
