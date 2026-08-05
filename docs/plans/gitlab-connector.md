# GitLab connector (GitHub stays working)

Status: **implemented 2026-08-04**, all six stages below shipped. Tracked
from `TODO.md`. This is the full staged plan; kept as historical design
record — see "Remaining risks" at the bottom for what's still unverified
against a live GitLab instance (the clone-auth token convention and the
discussion/comment-mapping shape).

**Follow-up (2026-08-05):** self-hosted GitLab instances commonly carry a
self-signed or expired cert — see [`insecure-tls.md`](./insecure-tls.md) for
the per-repo TLS-skip option this repo's real usage surfaced the need for,
plus a post-ship `undici` version-mismatch incident on the same code path.

## Context

DevDigest currently supports exactly one source-control provider: GitHub, wired
through a single DI seam (`Container.github()`) and a single `GitHubClient`
adapter (Octokit). The goal is to add GitLab (including self-managed/self-hosted
instances, not just gitlab.com) as a second provider, with full method parity to
GitHub's adapter, while GitHub's existing behavior and tests are untouched.

This plan follows the repo's own convention order (root `CLAUDE.md`): contracts
in `@devdigest/shared` change first, then schema, then adapters/DI, then
consuming modules, then the client.

**Two scope decisions were confirmed with the user (2026-08-03)**, differing
from the initially-drafted minimal version:
- **Self-hosted GitLab is in scope for V1**, not gitlab.com-only.
- **All 10 `GitHubClient`-equivalent methods get a real GitLab implementation**
  in V1, including the 4 not called by any route today (`openPullRequest`,
  `commitFiles`, `findOpenPr`, `getIssue`) — not stubs.

## Key facts established by reading the code (not re-derived at implementation time)

- `GitHubClient` interface: `server/src/vendor/shared/adapters.ts:143-167`.
  `RepoRef = { owner, name }` (adapters.ts:98-101) — **no host field today**,
  because GitHub is single-host. This must gain a host concept for GitLab.
- Real impl `OctokitGitHubClient`: `server/src/adapters/github/octokit.ts` — thin
  per-method wrappers over Octokit REST, each `withRetry`/`withTimeout`-wrapped.
  Mirror this structure for the GitLab adapter.
- Mock `MockGitHubClient`: `server/src/adapters/mocks.ts:130-240`.
- DI: `Container.github()` (`server/src/platform/container.ts:153-160`) — single
  cached instance, reads `GITHUB_TOKEN` via `SecretsProvider`, throws
  `ConfigError` if missing. `ContainerOverrides.github` lets tests inject a mock.
- Consumers of `container.github()`: `server/src/modules/pulls/routes.ts` (lines
  36, 198, 296, 319 — a `repo` row is already in scope at each call site before
  the client is resolved), `server/src/modules/polling/routes.ts:28`,
  `server/src/modules/settings/routes.ts:87` (the "test connection" /
  API-keys flow — not repo-scoped, calls the container method directly).
- **`reviewer-core` and the diff pipeline need zero changes.** Confirmed by
  reading `server/src/modules/reviews/run-executor.ts` and
  `.../reviews/diff-loader.ts` in full: diffs come from `container.git`
  (`GitClient`/simple-git against the local clone) or persisted `pr_files`
  patches — never from `GitHubClient`. Neither file imports `GitHubClient`.
- `repos` table (`server/src/db/schema/repos.ts`): `id, workspaceId, owner,
  name, fullName, defaultBranch, clonePath, lastPolledAt, createdBy, createdAt`
  — **no provider, no host column**.
- Repo-URL parsing/clone-auth is hardcoded to GitHub, not abstracted:
  `server/src/modules/repos/constants.ts` (`GITHUB_URL_REGEX`,
  `GIT_TOKEN_USERNAME = 'x-access-token'`, `GITHUB_HTTPS_HOST = 'github.com'`,
  `GITHUB_TOKEN_SECRET`), `server/src/modules/repos/helpers.ts`
  (`parseRepoUrl`, `withGitHubToken`), `server/src/modules/repos/service.ts`
  (`refresh()` hardcodes `` `https://github.com/${repo.fullName}.git` `` at
  line 121 — a real bug-in-waiting once a GitLab repo exists, since it
  reconstructs a clone URL from a stored row instead of the original input).
- Contracts (`server/src/vendor/shared/contracts/platform.ts`): `Repo`
  (140-151), `RepoInput` (135-138, just `{ url }`), `SecretsStatus` (126-132,
  flat booleans per provider), `ConnTestProvider` (106, enum
  `openai|anthropic|openrouter|github`) — all need a `gitlab` addition.
- `SecretKey` type (adapters.ts:274-279) is an open string union — adding
  `GITLAB_TOKEN` needs no type change, just usage.
- Server settings wiring is already **generic per-provider**, confirmed by
  reading: `server/src/modules/settings/constants.ts` —
  `SECRET_KEY_BY_PROVIDER: Record<ConnTestProvider, SecretKey>` — TypeScript's
  exhaustiveness check means this **must** gain a `gitlab` entry the moment
  `ConnTestProvider` gains `'gitlab'`, which is a good forcing function.
  `server/src/modules/settings/routes.ts:42` iterates this map generically for
  `/settings/secrets-status`, so no route logic changes there.
- Client settings wiring is **also already generic** — confirmed by reading
  `client/src/app/settings/[section]/_components/SettingsView/_components/SettingsApiKeys/constants.ts`:
  the API-keys panel is a plain declarative array (`KEY_ROWS: KeyRowSpec[]`),
  currently 4 entries (openai/anthropic/openrouter/github). Adding GitLab is a
  **one-line array addition** plus two i18n message keys
  (`messages/<locale>/*.json`) — no component logic change needed.
- Client deep-links: `client/src/lib/github-urls.ts` — `githubPrUrl`,
  `githubBlobUrl`, hardcoded `HOST = "https://github.com"`. Called from exactly
  2 files (via grep): `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`
  and `.../_components/FindingCard/FindingCard.tsx`.
- Currently-unused-by-routes methods (`openPullRequest`, `commitFiles`,
  `findOpenPr`, `getIssue`) exist for a not-yet-wired "auto-fix / open PR"
  feature; today they're exercised only by `server/test/adapters.test.ts`
  against `MockGitHubClient`. Per the user's decision, GitLab gets real
  implementations of all 10 anyway.

## Design decisions

**D1 — REST via `@gitbeaker/rest`.** Mirrors `OctokitGitHubClient`'s existing
thin-wrapper-per-method style 1:1, keeping `GitLabClient` trivially auditable
against `GitHubClient`. New dependency in `server/package.json`.

**D2 — Self-hosted GitLab support via a generic, host-aware URL parser + a
`host` column, not a separate "instance URL" Settings field.** Because the
GitLab host is already present in whatever URL the user pastes into "Add
repository" (`https://gitlab.mycompany.com/owner/repo`), the simplest correct
design is: keep `GITHUB_URL_REGEX` matching only `github.com` exactly as
today; add a second, generic regex that matches `https://<host>/<owner>/<repo>`
or `git@<host>:<owner>/<repo>.git` for **any host that isn't github.com**, and
treat that as GitLab. Store the extracted `host` per repo. This means **no new
global Settings field is needed** — self-hosted support falls out of
host-aware parsing, not new UI. `@gitbeaker/rest`'s `Gitlab` client already
accepts a `host` option for self-managed instances, so the adapter just needs
`host` threaded through construction.

*Explicit V1 assumption, flagged as a real limitation (see Open Questions):*
any non-github.com git remote is treated as GitLab-API-compatible. There's no
way to distinguish "self-hosted GitLab" from "some other git host" (Bitbucket,
a bare git server) from the URL alone — acceptable because the app only knows
about two providers today, but should be called out to the user, not silently
assumed correct for arbitrary URLs.

**D3 — `repos` table gains two columns: `provider` and `host`.**
`provider: text(..., { enum: ['github', 'gitlab'] }).notNull().default('github')`,
`host: text('host').notNull().default('github.com')`. The `.default()` on both
means existing rows backfill correctly with zero data-migration step — every
pre-existing repo reads as `{ provider: 'github', host: 'github.com' }` after
migration. Written once at `RepoService.add()` from URL parsing; read at every
point that currently assumes GitHub (clone auth, adapter resolution, refresh's
URL rebuild, client link-building).

**D4 — Keep `GitHubClient` untouched; add a parallel `GitLabClient` interface
with the same 10 methods, plus a narrow `VcsClient` structural supertype for
what routes actually call.** Renaming/generalizing `GitHubClient` itself would
touch every existing call site and risk regressing GitHub behavior for no
benefit. Instead:
- `GitLabClient` in `adapters.ts`, method-for-method identical signatures to
  `GitHubClient`'s 10 methods (full parity per the user's decision), reusing
  `RepoRef`, `PrMeta`, `PrDetail`, `IssueMeta` as-is. `RepoRef` gains an
  optional `host?: string` (used by GitLab; GitHub adapter ignores it / it's
  always `github.com` for GitHub repos).
- `PrReviewComment` / `CreateReviewCommentInput` may need a GitLab-specific
  variant if GitLab's discussion model (position object with
  `old_line`/`new_line`, `discussion_id`-based threading) doesn't map cleanly
  onto GitHub's `side: LEFT|RIGHT` + `in_reply_to_id` shape — resolve during
  Stage 2 against gitbeaker's real response shape, not guessed here (see Open
  Questions).
- `Container` gets `gitlab(host: string): Promise<GitLabClient>` — cached by
  host (`Map<string, GitLabClient>`, not a single field like `github()`, since
  a workspace could plausibly reference more than one self-hosted GitLab
  instance) — plus `vcsFor(repo: { provider, host }): Promise<VcsClient>` used
  by the 3 route files. `github()`'s signature and behavior are unchanged.

**D5 — Keep `PrMeta`/`PrDetail` naming as-is; no PR/MR terminology change.**
GitLab MRs map onto the existing generic shape in the adapter's mapping layer
(`number`↔`iid` — GitLab's project-scoped IID, not the global MR ID;
`branch`↔`source_branch`; `base`↔`target_branch`; `head_sha`↔`sha`). No
contract shape change needed.

## Staged implementation plan

### Stage 0 — contracts (`server/src/vendor/shared/`)
1. `adapters.ts`: add `GitLabClient` (10 methods, D4). Add `host?: string` to
   `RepoRef`. Add a `VcsClient` structural interface covering the 5-6 methods
   routes call (`listPullRequests`, `getPullRequest`, `listReviewComments`,
   `createReviewComment`, `currentLogin`, `postReview`) — both `GitHubClient`
   and `GitLabClient` satisfy it structurally.
2. `contracts/platform.ts`:
   - `SecretsStatus`: add `gitlab: z.boolean()`.
   - `ConnTestProvider`: add `'gitlab'`.
   - `Repo`: add `provider: z.enum(['github', 'gitlab'])` and `host: z.string()`.
   - `RepoInput`: unchanged — provider/host stay server-derived from the URL,
     never client-supplied (avoids a spoofing/mismatch class of bug).

### Stage 1 — DB schema
3. `server/src/db/schema/repos.ts`: add `provider` and `host` columns (D3).
4. `pnpm db:generate` then `pnpm db:migrate` — never hand-write the migration.

### Stage 2 — GitLab adapter
5. New `server/src/adapters/gitlab/gitbeaker.ts`: `GitbeakerGitLabClient
   implements GitLabClient`, constructed with `(token, host)`. Read
   `server/src/adapters/github/octokit.ts` in full first and mirror its
   structure method-by-method: same `withRetry`/`withTimeout` wrapping, same
   timeout constant, same pagination approach. Map GitLab MR `state`
   (`opened`/`closed`/`merged`/`locked`) onto the shared `PrStatus` enum.
   Implement all 10 methods (user's decision): `listPullRequests`,
   `getPullRequest`, `postReview` (GitLab has no direct "review" object the
   way GitHub does — likely maps to posting an MR-level note/discussion;
   resolve against gitbeaker's actual API), `listReviewComments`,
   `createReviewComment`, `openPullRequest` (→ `MergeRequests.create`),
   `commitFiles` (→ GitLab's Commits/RepositoryFiles API for one atomic
   multi-file commit), `findOpenPr` (→ `MergeRequests.all` filtered by source
   branch), `getIssue`, `currentLogin` (→ `Users.showCurrentUser`).
6. `server/src/adapters/mocks.ts`: add `MockGitLabClient` right after
   `MockGitHubClient`, same shape/pattern (`MockGitLabOptions`, deterministic
   fixture MR, recording arrays for posted/opened/committed/created), full
   10-method coverage mirroring `MockGitHubClient`'s existing shape.
7. `server/package.json`: add `@gitbeaker/rest` (pin a version; verify its
   `Gitlab` client method names against what Stage 2 needs before writing
   `gitbeaker.ts` — not confirmed against the live package during planning).

### Stage 3 — DI container
8. `server/src/platform/container.ts`:
   - `ContainerOverrides`: add `gitlab?: GitLabClient` (tests can still inject
     a single mock regardless of host — the override always wins, mirroring
     every other adapter override in this file).
   - Add `private _gitlabByHost = new Map<string, GitLabClient>()` and
     `async gitlab(host: string): Promise<GitLabClient>` — reads `GITLAB_TOKEN`
     via `SecretsProvider` (one token for all GitLab hosts in V1 — see Open
     Questions), throws `ConfigError('GITLAB_TOKEN is not configured')` if
     missing, constructs/caches `GitbeakerGitLabClient` per host.
   - Add `async vcsFor(repo: { provider: 'github'|'gitlab'; host: string }):
     Promise<VcsClient>` — `provider === 'gitlab' ? this.gitlab(repo.host) :
     this.github()`.
   - `invalidateSecretCaches()`: also clear `_gitlabByHost`.

### Stage 4 — repos module (URL parsing, clone auth, refresh)
9. `constants.ts`: keep `GITHUB_URL_REGEX`/`GITHUB_HTTPS_HOST` exactly as-is.
   Add a generic `GIT_HOST_URL_REGEX` matching `https://<host>/<owner>/<name>`
   or `git@<host>:<owner>/<name>.git` for any host, used only after the GitHub
   regex fails to match. Add `GITLAB_TOKEN_SECRET = 'GITLAB_TOKEN'`.
10. `helpers.ts`:
    - `parseRepoUrl(url)`: try `GITHUB_URL_REGEX` first (unchanged GitHub
      behavior/error message), else the generic host regex → `{ owner, name,
      provider: 'gitlab', host }`, else throw `invalid_repo_url` as today.
    - `withGitHubToken` → generalize to a provider-aware token-embed function.
      **GitLab's PAT-over-HTTPS convention differs from GitHub's** — GitHub
      uses `x-access-token:<token>@host`; GitLab conventionally uses
      `oauth2:<token>@host`. Verify this against real GitLab docs/a live token
      before Stage 4 ships (flagged in Open Questions) — get it wrong and
      private self-hosted clones silently fail auth.
    - `toRepoDto`: include `provider` and `host` in the mapped output.
11. `repository.ts`: `InsertRepo` gains `provider`, `host`; `insert()` passes
    them through.
12. `service.ts`:
    - `add()`: thread `provider`/`host` from `parseRepoUrl` into
      `repo.insert(...)` and into `CloneJobPayload` (add both fields).
    - `runCloneJob()`: branch the secret lookup on `payload.provider`
      (`GITLAB_TOKEN_SECRET` vs `GITHUB_TOKEN_SECRET`) and use the matching
      token-embed helper with `payload.host`.
    - `refresh()`: replace the hardcoded `github.com` literal at line 121 with
      a provider/host-aware URL builder using the stored `repo.provider` /
      `repo.host` — this is the concrete bug the current code has once a
      GitLab repo exists.

### Stage 5 — routes (pulls, polling, settings)
13. `pulls/routes.ts`: all 4 `container.github()` call sites (36, 198, 296,
    319) become `container.vcsFor(repo)` — `repo` is already fetched in scope
    at each site. Local variable type: `VcsClient | null` (from
    `@devdigest/shared`). No other logic change — the local-first
    try/catch-and-degrade pattern is already provider-agnostic.
14. `polling/routes.ts:28`: same swap.
15. `settings/routes.ts` + `settings/constants.ts`:
    - Add a `gitlab` branch alongside the existing `if (provider ===
      GITHUB_PROVIDER)` block at routes.ts:86 — calls `container.gitlab(host)`
      (host from the request, or omitted → defaults to gitlab.com for the
      "test connection" UX when the user hasn't added a self-hosted repo yet;
      resolve the exact UX for self-hosted test-connection in Open Questions).
    - `SECRET_KEY_BY_PROVIDER` gains `gitlab: 'GITLAB_TOKEN'` — TypeScript's
      `Record<ConnTestProvider, SecretKey>` exhaustiveness check forces this
      the moment Stage 0 adds `'gitlab'` to `ConnTestProvider`.
    - `/settings/secrets-status` needs no route-logic change — it already
      iterates the map generically.

### Stage 6 — client
16. `client/src/lib/github-urls.ts` → generalize (recommend renaming to
    `vcs-urls.ts`): `prUrl(repoFullName, number, provider, host)` /
    `blobUrl(repoFullName, sha, file, provider, host, startLine, endLine)`.
    **GitLab's URL shape differs from GitHub's**, not just the host — GitLab
    uses `/-/blob/{sha}/{file}` (not `/blob/{sha}/{file}`) and its multi-line
    fragment syntax differs from GitHub's `#L{n}-L{m}`. Verify exact GitLab
    conventions during implementation.
17. Update the 2 call sites (`repos/[repoId]/pulls/[number]/page.tsx`,
    `.../_components/FindingCard/FindingCard.tsx`) to pass
    `activeRepo.provider`/`activeRepo.host` (now on the `Repo` DTO per
    Stage 0) into the generalized URL functions.
18. `SettingsApiKeys/constants.ts`: add a `gitlab` row to `KEY_ROWS` (one line,
    confirmed mechanical per the research above) + 2 new i18n keys in
    `messages/<locale>/*.json` (`apiKeys.gitlabLabel`, `apiKeys.gitlabHint`).
    If self-hosted test-connection needs a host input (see Open Questions),
    this component may need a small extension beyond the label/hint pattern
    the other 4 rows use — confirm during implementation.

## What must NOT change

- `@devdigest/reviewer-core` — confirmed zero changes needed; the diff
  pipeline never touches `GitHubClient`/`GitLabClient`.
- `GitHubClient`'s existing method signatures and `OctokitGitHubClient` —
  untouched. No existing GitHub route behavior changes.
- `MockGitHubClient` and `server/test/adapters.test.ts`'s existing GitHub
  assertions — untouched.
- Existing `repos` rows — `.default()` on both new columns means no
  backfill/data-migration script is needed.

## Test strategy

- **New hermetic unit tests** (no `.it.test.ts`, no DB):
  - `server/src/modules/repos/helpers.test.ts` (doesn't exist yet — new
    coverage): `parseRepoUrl` for gitlab.com URLs (https + ssh forms), a
    self-hosted host (e.g. `gitlab.mycompany.com`), the existing GitHub cases
    as regression coverage, and the "matches neither" `invalid_repo_url` case.
    Token-embed helper for GitLab-host vs GitHub-host vs unknown-host inputs.
  - Extend `server/test/adapters.test.ts` with `MockGitLabClient`-based
    assertions mirroring the existing `MockGitHubClient` block, covering all
    10 methods for parity.
  - Route-level tests (locate/confirm existing pattern for
    `pulls`/`polling` at implementation time) — inject
    `ContainerOverrides.gitlab` with `MockGitLabClient`, assert a
    `provider: 'gitlab'` repo routes through `vcsFor` correctly, alongside
    existing GitHub-repo assertions proving no regression.
- **`.it.test.ts` (DB-backed):** assert `repos.provider`/`repos.host` persist
  and default correctly; `RepoRepository.insert`/`findByFullName` round-trip
  both new columns.
- **E2E:** out of scope for this plan. `e2e/CLAUDE.md` requires flows stay
  deterministic against seeded data; adding a GitLab-seeded repo to
  `server/src/db/seed.ts` plus a new flow is a reasonable fast-follow once the
  adapter is real and stable, not a blocker here.

## Verification (once implemented)

1. `cd server && pnpm typecheck && pnpm test` (hermetic unit suite) — new
   GitLab mock/helper tests pass, all existing GitHub tests still pass
   unmodified.
2. `pnpm exec vitest run .it.test` — new/extended integration test for the
   `provider`/`host` columns.
3. Manual: add a real gitlab.com repo URL and a self-hosted GitLab repo URL
   (if a test instance/token is available) via the running app's "Add
   repository" flow; confirm clone succeeds, PR/MR list loads, and a review
   runs end-to-end exactly as it does for a GitHub repo.
4. `cd client && pnpm typecheck && pnpm test` — confirm the Settings API-keys
   panel renders the new GitLab row and the PR-detail/finding-card deep-links
   resolve to the correct host for a GitLab-provider repo.

## Open questions / risks (should be resolved during implementation, not blocking the plan)

1. **GitLab PAT clone-auth convention** — verify `oauth2:<token>@<host>` (or
   whatever GitLab's actual documented convention is) against real GitLab
   before Stage 4 ships. Getting this wrong silently breaks private clones.
2. **GitLab discussions vs GitHub review comments** — `PrReviewComment`'s
   `side`/`in_reply_to_id` shape may not map cleanly onto GitLab's
   discussion/position model; may need a GitLab-specific comment DTO variant,
   decided against gitbeaker's real response shape in Stage 2.
3. **Single global `GITLAB_TOKEN` across all self-hosted instances** — V1
   assumes one token works for every GitLab host a workspace references. A
   workspace with both gitlab.com and a self-hosted instance (needing
   different PATs) isn't supported; flag if this matters in practice.
4. **Any non-github.com URL is assumed GitLab-API-compatible** (D2's explicit
   assumption) — there's no way to distinguish a real self-hosted GitLab
   remote from some other git host from the URL shape alone. Acceptable for a
   two-provider app, but worth surfacing to the user (e.g. a clear error if
   the GitLab API calls fail against a host that turns out not to be GitLab).
5. **Settings "test connection" UX for self-hosted** — needs a host input
   somewhere for testing a self-hosted GitLab token before any repo has been
   added yet (there's no repo row to read a host from at that point). Decide
   whether test-connection defaults to gitlab.com only, or gains a host field.
6. **`@gitbeaker/rest` version/API surface** — not verified against the live
   package during planning (no network access in this pass); pin a version
   and confirm method names (`MergeRequests.all`, `MergeRequestDiscussions.*`,
   `Commits.create` or `RepositoryFiles.*`, etc.) before writing the adapter.
