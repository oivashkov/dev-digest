# Skip TLS validation for self-hosted GitLab (self-signed / expired certs)

Status: **implemented 2026-08-05**. Follow-on to
[`gitlab-connector.md`](./gitlab-connector.md) — extends the same
`provider`/`host` schema work with a third per-repo column. Kept as a
historical design + incident record: the plan below shipped as designed, but
a **second bug surfaced during live use after shipping** (a library version
mismatch, not a design flaw) — see "Post-ship incident" at the bottom.

## Context

A self-hosted GitLab instance with a self-signed or expired TLS certificate
failed every outbound call: `TypeError: fetch failed: certificate has
expired` from `@gitbeaker/rest`. This blocked PR sync entirely for any
internal GitLab instance with a non-publicly-trusted cert — common for
on-prem setups.

The fix is a per-repo "skip TLS validation" flag, set when the repo is added.
**Scoped to that one repo's connections, never global** — disabling Node's
TLS verification process-wide (`NODE_TLS_REJECT_UNAUTHORIZED=0`) would also
strip certificate checking from the OpenAI/Anthropic/OpenRouter calls, a real
MITM exposure on unrelated, security-sensitive traffic.

**Two HTTP paths hit the same cert, both needed the fix**:
1. The GitLab API client (`@gitbeaker/rest`) — the error above.
2. `git clone`/`git fetch` for that repo (`simple-git`), which also goes over
   HTTPS to the same host — would still fail the same way, just at a
   different step (initial clone, or `repo-intel`'s incremental resync).

## Mechanisms (confirmed against `node_modules` source, not guessed)

- **gitbeaker → undici dispatcher.** `@gitbeaker/rest`'s `Gitlab` constructor
  accepts an `agent` option (typed as Node's `http.Agent` for lack of an
  undici type dependency, but forwarded verbatim as fetch's `dispatcher`:
  `@gitbeaker/rest/dist/index.mjs` — `if (agent) fetchArgs.push({
  dispatcher: agent })`). An `undici.Agent({ connect: { rejectUnauthorized:
  false } })` passed there skips verification for exactly that client
  instance. The TS gap is bridged with `as unknown as import('http').Agent`.
- **simple-git → per-instance `-c` config.** `simpleGit(baseDir, { config:
  ['http.sslVerify=false'] })` prefixes every command run by that instance
  with `-c http.sslVerify=false` (documented in simple-git's README, "Per-
  command Configuration" — not obviously visible in the bundled `.d.ts`
  files). Scoped to the `SimpleGit` instance, not global git config.
- **GitHub (Octokit) is explicitly out of scope** — the request was
  GitLab-specific. The field name (`insecure_tls`, not
  `gitlab_insecure_tls`) is generic enough that GitHub Enterprise support
  later is a small follow-up, not a rework.

## Design

- **New column**: `repos.insecure_tls boolean not null default false` —
  same pattern as `provider`/`host`, defaulted so existing rows are
  unaffected.
- **`RepoRef` gains `insecureTls?: boolean`**, alongside its existing
  optional `host` — the one flag threaded through every `GitClient`/
  `GitLabClient` call.
- **`Container.gitlab(host, insecureTls)`** — cache key
  `` `${host}::${insecureTls}` `` (two repos could disagree on this for the
  same host).
- **UI: hidden behind a collapsed "Advanced" disclosure**, unchecked by
  default, not a permanently-visible checkbox — a security-relevant escape
  hatch (defeats MITM protection for that repo's traffic) shouldn't be as
  easy to reach as the URL field itself.

## Implementation

- **Contracts** — `RepoRef.insecureTls` (`adapters.ts`), `Repo.insecure_tls`
  / `RepoInput.insecure_tls` (`contracts/platform.ts`), mirrored into
  `client/src/vendor/shared/` (the two vendor copies are NOT auto-synced —
  see `server/INSIGHTS.md`).
- **Schema** — `insecure_tls` column, migration `0012_nostalgic_madame_web.sql`.
- **GitLab adapter** — `server/src/adapters/gitlab/gitbeaker.ts`: constructor
  takes `insecureTls`, builds the undici `Agent` when true. `undici` added
  as an explicit `server/package.json` dependency.
- **DI container** — `server/src/platform/container.ts`: `gitlab(host,
  insecureTls)` cache key, `vcsFor(repo)` threads `repo.insecureTls`.
- **Git adapter** — `server/src/adapters/git/simple-git.ts`: private
  `gitOpts(repo)` helper, passed to every `simpleGit(...)` call site
  (`this.git()` helper + both branches of `clone()`).
- **Repos module** — `repository.ts` (`InsertRepo.insecureTls`,
  `toRepoDto`), `service.ts` (`add()`, `CloneJobPayload`, `runCloneJob()`,
  `refresh()`), `routes.ts` (`POST /repos` reads `insecure_tls` off the body).
- **repo-intel** — 5 `RepoRef` construction sites needed the field added by
  hand (TypeScript's optional-field typing doesn't flag an omission):
  `repo-intel/service.ts:149,239,488`, `repo-intel/pipeline/incremental.ts:82`,
  `repo-intel/pipeline/full.ts:96`. Also `RepoIntelRepository.getRepoBasics()`'s
  trimmed `SELECT` needed the new column added — it only selected
  `owner/name/defaultBranch/clonePath`, not the full row.
  `reviews/diff-loader.ts` added it too for consistency, though `git diff` is
  local-only and doesn't strictly need it.
- **Client** — `useAddRepo()` accepts `RepoInput` instead of a bare URL
  string; `AddRepoView.tsx` gets a collapsed "Advanced" section (`Checkbox`
  from `@devdigest/ui`) with an explicit MITM-risk warning.

## Test coverage

- `server/test/container-gitlab-tls.test.ts` — cache-key identity: same
  `(host, insecureTls)` reuses an instance, a different `insecureTls` for
  the same host resolves to a different one, `vcsFor()` threads the flag
  correctly.
- `server/test/simple-git-tls.test.ts` — mocks `simple-git`'s `simpleGit`
  export and asserts the `-c http.sslVerify=false` config array is present
  only when `insecureTls: true`.
- `server/test/integration.it.test.ts` — extended the GitLab round-trip test
  (DB-backed) to assert `insecure_tls` defaults to `false` and persists
  `true` for a self-hosted URL end to end through `POST /repos`.

## Post-ship incident: undici major-version mismatch

**Symptom** (live, after shipping): a *different* error on the exact same
code path — `TypeError: fetch failed: invalid onRequestStart method`,
originating from undici's own `assertRequestHandler`.

**Root cause:** Node bundles its own internal undici build
(`process.versions.undici` — `7.11.0` on the Node v24.4.0 used here).
`@gitbeaker/rest`'s `defaultRequestHandler` always calls the *global*
`fetch()`/`Request` — never an imported one — so it's Node's bundled undici
7 doing the actual dispatch. `pnpm add undici` (no version pin) resolved to
the npm `latest` tag, **undici 8.10.0**, which redesigned its internal
Handler/interceptor protocol in the 7→8 major bump. Passing an 8.x `Agent`
as the `dispatcher` to a fetch backed by undici 7 broke the handshake.

**Fix:** `pnpm add undici@^7` — pin to the major line matching Node's
bundled version, not `latest`. Verified against a real self-signed
certificate (`https://self-signed.badssl.com/` via the same `Agent`
construction this code uses → `200`, no error) and the full test suite
re-run clean.

**Takeaway, recorded in `server/INSIGHTS.md`:** when a library's requester
uses the *global* `fetch`, any `dispatcher`/`Agent` object passed to it must
come from an `undici` install whose **major version** matches
`process.versions.undici` for the Node version in use — this is not
guaranteed stable across undici majors and isn't something `tsc` can catch
(the type surfaces are compatible; only the runtime protocol isn't). If this
resurfaces after a Node upgrade, check `node -e
"console.log(process.versions.undici)"` first.

## Remaining risks (not blocking, flagged for awareness)

- One global `GITLAB_TOKEN` is assumed to authenticate every GitLab host a
  workspace references — mixing gitlab.com + a self-hosted instance with a
  different PAT isn't supported.
- No way to distinguish a real self-hosted GitLab remote from some other
  non-GitHub git host by URL shape alone — `insecure_tls` will happily
  "succeed" (skip verification) against any HTTPS host, GitLab or not.
- The `undici` major-version pin is a moving target tied to whatever Node
  bundles internally; a future Node major could require re-pinning.
