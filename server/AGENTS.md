# server (`@devdigest/api`) — agent notes

## Commands

```sh
pnpm dev                                    # tsx watch, :3001
pnpm typecheck                              # tsc --noEmit
pnpm test                                   # everything
pnpm exec vitest run --exclude '**/*.it.test.ts'   # hermetic units only
pnpm exec vitest run .it.test                      # DB-backed only
pnpm db:generate && pnpm db:migrate         # schema change → migration → apply
pnpm db:seed                                # idempotent demo data
```

## Conventions

- One feature = one `src/modules/<name>/` plugin, registered statically in
  `src/modules/index.ts` (one import + one `app.register`).
- Routes declare Zod `params`/`body`/response schemas from `@devdigest/shared`
  via `fastify-type-provider-zod`. Invalid input is rejected with `422` **before**
  the handler runs — never hand-roll `Schema.parse(req.body)`.
- Plugins (helmet, cors, rate-limit, SSE) register **before** modules so the
  encapsulated module plugins inherit them and the shared error handler.
- External I/O goes through an adapter behind the DI container
  (`src/platform/container.ts`) so tests can swap in `src/adapters/mocks.ts`.
- Schema changes: edit `src/db/schema.ts`, then `pnpm db:generate`. Never
  hand-write a migration file.
- Secrets are read only through `LocalSecretsProvider`
  (`src/adapters/secrets/local.ts`). `GITHUB_TOKEN` is canonical; `GITHUB_PAT` is
  accepted as a fallback. `GITLAB_TOKEN` covers every GitLab host (gitlab.com +
  self-hosted) a workspace references.
- A repo's VCS provider/host/insecure-TLS are stored columns
  (`repos.provider|host|insecure_tls`), detected from the URL at add-time —
  never call `container.github()`/`container.gitlab()` directly from a route;
  use `container.vcsFor(repo)`.

## Gotchas

- Migrations are **not** applied on boot.
- `loadConfig` marks every secret optional — the server boots with no keys, so a
  missing key surfaces at call time, not at startup.
- The DB schema already contains every table, including ones no starter code
  writes to. An empty table is expected, not a bug.
- `repo-intel` clones into `server/clones/` — gitignored, and excluded from any
  search you run.

## Read when

- Read `INSIGHTS.md` first for what was already tried here, and record new
  findings there at the end of the task.
- Read `README.md` for the API map and the request/DI flow diagram.
- Read `src/modules/repo-intel/README.md` when touching indexing or the repo map.
- Read `../docs/plans/gitlab-connector.md` and `../docs/plans/insecure-tls.md`
  when touching the GitHub/GitLab adapters, `Container.vcsFor()`, or repo
  URL/TLS handling.
- Read `../TESTING.md` before adding a test or changing the unit/integration split.
