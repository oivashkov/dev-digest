# `@devdigest/mcp-server` — local MCP server

A local [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes DevDigest's reviewer agents to any MCP-capable client (Claude Code,
Claude Desktop, etc.) over **stdio**. It is a thin HTTP client to the DevDigest
Fastify API — it imports no `server/` internals, only the read-only
`@devdigest/shared` contracts via a tsconfig path alias.

## Precondition: start the API first

This package never starts the DevDigest API itself. Before running (or
connecting an MCP client to) this server, start the API from the repo root:

```sh
./scripts/dev.sh
```

That boots Postgres + the API on `:3001` (+ the web studio on `:3000`, unless
you pass `--no-client`). See the flags in root `AGENTS.md` for options
(`--no-seed`, `--db-only`, …). If a tool call fails with a connection error,
this is almost always the cause — the server's error mapping points back here
("start it with `./scripts/dev.sh`").

## Tools

This server exposes five tools (see `docs/architecture.md` for the layering
behind them):

| Tool | What it does |
|---|---|
| `list_agents` | List the reviewer agents configured in this workspace. |
| `run_agent_on_pr` | Run a reviewer agent on a pull request end-to-end. |
| `get_findings` | Read the findings from a completed (or most recent) review of a PR. |
| `get_conventions` | Read a repo's detected coding conventions. |
| `get_blast_radius` | Read a PR's blast radius: changed symbols, their callers, and impacted endpoints/crons. |

## Architecture

This package follows an MCP-adapted version of the project's
`backend-onion-architecture` skill: thin presentation tools (`src/tools/*`)
call an application service (`src/service/**`), which is the only layer
allowed to orchestrate resolution/polling/shaping, which in turn calls a
single HTTP infrastructure adapter (`src/http/client.ts`) — the only `fetch`
site in the package. See `mcp-server/specs/mcp-server-plan.md` for the full
plan and `mcp-server/docs/architecture.md` for the layering table.

## Commands

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run build        # same as typecheck — this package emits no JS
npm run dev           # tsx watch src/index.ts
npm start              # tsx src/index.ts — run the stdio server once
npm test                # vitest, hermetic — mocks the HTTP port, no running API needed
```

**npm, not pnpm.** This package has its own `package-lock.json` and is never
part of a pnpm workspace — see root `AGENTS.md`'s package-manager map
(`reviewer-core/` and `e2e/` follow the same npm convention).

## Configuration

Copy `.env.example` to `.env` and adjust if needed — every variable has a
sane local default, so this is optional for the common case (API on its
default port `3001`):

| Variable | Default | What |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | Base URL of the local DevDigest API. |
| `MCP_POLL_INTERVAL_MS` | `2000` | Poll interval for the `run_agent_on_pr` timeout-fallback loop. |
| `MCP_HARD_TIMEOUT_MS` | `120000` | Hard ceiling for that poll loop before returning a timeout-fallback result. |
| `MCP_REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout for a single HTTP call to the DevDigest API. |

See `src/config.ts` for the zod schema these are validated against.
