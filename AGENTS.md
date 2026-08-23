# DevDigest — agent map

## Before answering

Before answering any question or starting any task, FIRST search the relevant
package's `docs/`, `specs/` and `INSIGHTS.md` for what was asked about. These are
curated and may already answer it in full. Only after that, read the code.

Order: `<module>/specs/` (what we intend to build) → `<module>/docs/` (how it
works) → `<module>/INSIGHTS.md` (what we already tried and rejected) → source.
If a curated file answers the question, cite it instead of re-deriving from
code.

## After finishing

At the end of any non-trivial task, record what was learned into the
`INSIGHTS.md` of the module you touched, after checking that a similar entry
isn't already there. **Do not skip this step.**

Skip only the writing, and only when nothing non-obvious came up — a typo or a
routine change is not an insight, and noise costs more than silence.

## Before opening a PR

Before running `gh pr create`, or pushing a branch you intend to become a
PR, run the `pr-self-review` skill. It maps the diff to whichever project
skills apply (frontend-architecture, backend-onion-architecture, etc.) and
blocks on any CRITICAL finding. `./scripts/install-hooks.sh` wires the same
check into a local `pre-push` git hook for enforcement outside a Claude
Code session — see `.claude/skills/pr-self-review/README.md`.

## Stack

Node ≥22 · pnpm ≥10 · TypeScript · Fastify 5 · Next.js 15 / React 19 ·
Drizzle ORM + Postgres (pgvector) · Zod · Vitest · agent-browser (e2e)

## Commands

| Task            | Command                                                    |
| --------------- | ---------------------------------------------------------- |
| Boot everything | `./scripts/dev.sh` (Postgres + API :3001 + web :3000)      |
| Server          | `cd server && pnpm dev \| build \| typecheck \| test`      |
| Migrations      | `cd server && pnpm db:generate` then `pnpm db:migrate`     |
| Client          | `cd client && pnpm dev \| build \| typecheck \| test`      |
| Engine          | `cd reviewer-core && npm test \| npm run typecheck`        |
| E2E (hermetic)  | `cd e2e && npm run e2e:hermetic`                            |
| MCP server      | `cd mcp-server && npm run dev \| build \| typecheck \| test` |

Flags for `dev.sh`: `--no-seed` · `--no-client` · `--db-only` · `--help`.

## Where things live

| Path                        | What                                                     |
| ---------------------------- | ---------------------------------------------------------- |
| `server/`                   | Fastify API + Drizzle. Indexer at `src/modules/repo-intel/` |
| `client/`                   | Next.js studio, App Router                                |
| `reviewer-core/`            | Pure engine: diff + repo map → prompt → LLM → findings    |
| `e2e/`                      | Deterministic browser flows, no LLM                       |
| `mcp-server/`               | Local stdio MCP server — thin HTTP client to `server/`'s API for MCP tool clients |
| `server/src/vendor/shared/` | `@devdigest/shared` — Zod contracts for every package     |
| `client/src/vendor/ui/`     | `@devdigest/ui` — vendored UI primitives                  |

## Conventions (non-default — you cannot infer these from the code)

- **Not a monorepo workspace.** Each package has its own `package.json` and its
  own lockfile. `server/` + `client/` use **pnpm**; `reviewer-core/` + `e2e/` +
  `mcp-server/` use **npm**. Never run the wrong package manager in a package.
- Cross-package imports resolve through **tsconfig path aliases**, not published
  modules. `reviewer-core` is consumed as TypeScript **source** and never emits
  JS — its `build` is a typecheck.
- Contracts change in `@devdigest/shared` **first**, then in consumers. The same
  Zod schema drives request validation and response serialization.
- Server tests split by filename: `*.it.test.ts` are DB-backed (testcontainers
  Postgres). Everything else must stay hermetic.
- Secrets live in `~/.devdigest/secrets.json` (mode 0600) with `process.env` as
  fallback — never in git or the database.

## Gotchas

- **Migrations do not run on boot.** `relation ... does not exist` means you
  skipped `pnpm db:migrate`.
- **Never `docker compose down -v`** to "reset" — `-v` destroys the
  `devdigest_pgdata` volume and every imported repo and review with it.
- The server reaps orphaned `running` runs on boot; a run stuck in `running` is
  usually a crashed process, not a logic bug.

## Do not touch

- `server/clones/**` — cloned user repos, including a full copy of dev-digest
  itself. **Always exclude it from grep and glob** or you will read and edit the
  wrong file. Gitignored; never commit its contents.
- `**/src/vendor/**` — vendored. Exception: `vendor/shared` changes only as part
  of a deliberate contract change.
- `**/node_modules/**`, `pnpm-lock.yaml`, `package-lock.json`.

## Read when

- Read `TESTING.md` when adding a test or touching CI.
- Read `docs/agent-prompts/` when changing a built-in agent's system prompt or
  choosing a model.
- Read `server/README.md` when adding or changing an API route.
- Read `client/README.md` when adding a page or a data hook.
- Read `reviewer-core/README.md` when touching prompt assembly, structured
  output, or the grounding gate.
- Read `e2e/README.md` before writing or debugging a browser flow.
- Read `mcp-server/README.md` and `mcp-server/docs/architecture.md` when
  adding or changing an MCP tool.
- Read `INSIGHTS.md` at repo root for decisions that span more than one package.
