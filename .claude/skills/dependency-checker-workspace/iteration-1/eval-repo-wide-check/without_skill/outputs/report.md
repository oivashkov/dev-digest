# dev-digest — Dependency Audit (repo-wide)

Ran `pnpm audit`/`npm audit` (both `--omit=dev` and full-tree) and `pnpm|npm outdated` against all six packages, plus `du -sh` on each `node_modules`. No installs were run; all `node_modules` used were already present on disk (`e2e` has none, but `npm audit`/`outdated` work directly off its lockfile). This is not a workspace — every package has its own lockfile, so results are per-package.

## 1. How heavy is each package?

| Package | `node_modules` size | direct deps | direct devDeps | package manager |
|---|---|---|---|---|
| `client` | **620 MB** | 11 | 12 | pnpm |
| `evals` | **461 MB** | 2 | 5 | pnpm |
| `server` | **241 MB** | 25 | 8 | pnpm |
| `reviewer-core` | 156 MB | 2 | 4 | npm |
| `mcp-server` | 83 MB | 2 | 4 | npm |
| `e2e` | not installed | 0 | 3 | npm |
| **Total on disk** | **≈ 1.5 GB** | | | |

Biggest contributors:
- **`client` (620 MB)**: `next` (152 MB), `mermaid` (75 MB — used just to render diagrams), `lucide-react` (36 MB icon set), plus a duplicate `typescript` (23 MB) every package carries independently since this isn't a workspace.
- **`evals` (461 MB)**: almost entirely one dependency — `@anthropic-ai/claude-agent-sdk-darwin-arm64` alone is **345 MB** (75% of the whole package's footprint), a platform-specific native binary pulled in transitively by `@anthropic-ai/claude-agent-sdk`.
- **`server` (241 MB)**: `typescript` (23 MB), `js-tiktoken` (21 MB), `drizzle-orm` (13 MB), `openai` (7.4 MB), `drizzle-kit` (7.4 MB).
- **`reviewer-core`/`mcp-server`** each carry a full duplicated `vite`+`@esbuild` toolchain (~33 MB each) purely for test/build tooling, with no workspace to dedupe it.

Because five separate installs exist instead of one workspace, common tooling (`typescript`, `vitest`, `vite`, `zod`, `@types/node`) is fully duplicated 4-5× on disk — the main structural driver of total size.

## 2. Vulnerabilities

### Production-facing (highest priority — these ship)

**`server`** — 6 high, all transitive through dependencies you control the version of:

| Package | Issue | Fixed in | Pulled in by |
|---|---|---|---|
| `fast-uri` (×3 advisories) | host-confusion / IDN canonicalization bugs | ≥3.1.5 | `fastify@5.8.5` → `@fastify/ajv-compiler` → `ajv`/`ajv-formats` (27 paths) |
| `find-my-way` | HTTP/2 DoS | ≥9.6.1 | `fastify@5.8.5` directly |
| `form-data` | CRLF injection via unescaped multipart field/filename | ≥4.0.6 | `@anthropic-ai/sdk@0.33.1` / `openai@4.104.0` → `@types/node-fetch` |
| `drizzle-orm` | SQL injection via improperly escaped identifiers | ≥0.45.2 | direct dep, currently `0.38.4` |

`fastify` has a same-major update available (`5.8.5` → `5.12.1` per `pnpm outdated`), which very likely carries a patched `find-my-way`/`fast-uri` chain — a low-risk fix.

**`client`** — 8 high / 15 moderate / 3 low, dominated by:

| Package | Current | Issue(s) | Fixed in |
|---|---|---|---|
| `next` | 15.5.19 | Server Actions DoS, SSRF (×2), cache-confusion (×3), unauth Server Function disclosure, Image-Opt SVG DoS | **15.5.21** — one patch release away |
| `postcss` (bundled) | 8.4.31/8.5.15 | arbitrary file read via `sourceMappingURL`, path traversal to `.map` (×2, incomplete-fix follow-up) | ≥8.5.23 |
| `nanoid` (bundled) | 3.3.12 | non-secure generator loops indefinitely | ≥3.3.18 |
| `mermaid` | 11.15.0 | prototype pollution, CSS injection, radar/XY-chart DoS (5 advisories) | 11.16.1 |
| `dompurify` (bundled by mermaid) | — | multiple XSS/pollution issues (4 advisories) | ≥3.4.13 |
| `next-intl` | 3.26.5 | open redirect, prototype pollution via translation catalog keys | ≥4.9.2 (major bump) |

**`reviewer-core`** (prod) — 1 high: same `form-data` CRLF issue via `openai`.

**`mcp-server`, `evals`** — 0 prod vulnerabilities.

### Dev/build tooling (lower real-world risk, cheap to fix)

All five packages using `vitest` (`server`, `client`, `reviewer-core`, `mcp-server`, `evals`) are pinned to **`vitest@2.1.9`**, which carries a **critical** advisory — arbitrary file read/execute when the Vitest UI server is listening (fixed in ≥3.2.6). Exploitable only if `vitest --ui` is exposed, so not internet-facing today, but it's identical across all five packages and needs a 2.x→3.x/4.x major bump (latest `4.1.11`) — worth a coordinated scheduled upgrade.

`reviewer-core` and `mcp-server` also each duplicate a vulnerable `vite` (high: `.map` path traversal, `server.fs.deny` bypass on Windows) and `esbuild` (moderate: dev server probeable by any website).

## 3. Outdated packages (notable gaps)

- `server`: `openai` 4.104.0 → 7.5.0 (3 majors behind), `typescript` 5.9.3 → 7.0.2, `@anthropic-ai/sdk` 0.33.1 → 0.120.0, `zod` 3.25.76 → 4.4.3, `testcontainers`/`@testcontainers/postgresql` 10.28.0 → 12.1.0.
- `client`: `next` one patch behind a security fix, `next-intl` a full major behind (security-relevant), `lucide-react` 0.469.0 → 1.34.0, `recharts` 2.15.4 → 3.10.1, `zod` 3.25.76 → 4.4.3.
- `evals`: `@anthropic-ai/claude-agent-sdk` 0.3.242 → 0.3.245 (trivial), `openai` 4.104.0 → 7.5.0.
- `zod` sits on 3.x in every consumer (`server`, `client`, `reviewer-core`, `mcp-server`) while 4.x is current; per `AGENTS.md`, a bump has to start in `@devdigest/shared` since every package's contracts derive from it.

## 4. What to do first (priority order)

1. **Bump `fastify` in `server` to `5.12.1`.** Same-major, resolves 5 of 6 high-severity prod findings in one low-risk change — cheapest, highest-impact fix in the repo.
2. **Bump `next` in `client` to at least `15.5.21`.** One patch release away, fixes 8 high/moderate CVEs (SSRF, DoS, cache confusion, unauth disclosure) before any major-bump planning.
3. **Bump `drizzle-orm` (server) to ≥0.45.2.** Direct dependency, fixes a SQL-injection-class advisory in the ORM itself.
4. **Bump the AI SDKs (`openai`, `@anthropic-ai/sdk`) that pull in vulnerable `form-data`** — affects `server` and `reviewer-core`'s prod tree; check changelogs before jumping majors on `openai`.
5. **Upgrade `mermaid` (client) to ≥11.16.1** — clears 5 advisories plus the bundled vulnerable `dompurify`, routine minor bump.
6. **Schedule a coordinated `vitest` major upgrade (2.x → ≥3.2.6/4.x) across all five packages** — critical CVE but dev-only exposure; batch it rather than firefighting since the version is identical everywhere.
7. **Investigate the 345 MB `@anthropic-ai/claude-agent-sdk-darwin-arm64` binary in `evals`** — confirm whether `evals` needs the full Agent SDK at runtime or a lighter client, since it makes this package almost as heavy as `client`.
8. **Longer-term:** migrate `next-intl` 3→4 (two real advisories); lead `zod` 3→4 from `@devdigest/shared`; reassess whether `lucide-react` (36 MB) and `mermaid` (75 MB) justify their disk weight in `client`.

## Note on repo state at audit time

`evals/package.json`, `evals/pnpm-lock.yaml`, and a new `evals/pnpm-workspace.yaml` were uncommitted/modified locally (adding `allowBuilds: { esbuild: true }` in place of the old `pnpm.onlyBuiltDependencies` field). This doesn't change any finding above — noted only because the package was mid-change when audited.
