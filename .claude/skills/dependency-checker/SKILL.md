---
name: dependency-checker
description: Analyzes dev-digest's npm/pnpm dependencies across all its packages (server, client, reviewer-core, e2e, mcp-server, evals — each with its own package.json and lockfile, since this repo is not a workspace) and produces a structured dependency report — a Mermaid graph, per-package size/type breakdown, a repo-wide heaviest-dependencies table, vulnerabilities, outdated packages, and a ranked prioritized-recommendations section. Use this whenever the user asks to check, audit, analyze, or visualize dependencies; asks "what's heavy/bloated in node_modules"; asks about outdated or vulnerable packages; asks for a dependency diagram/graph; or wants to know what to upgrade, remove, or replace — even if they don't say "dependency-checker" by name.
---

# Dependency checker

Produces `docs/dependency-report.md`: a developer-scannable audit of every
package's dependencies — what they weigh, how they relate, what's outdated
or vulnerable, and what to actually do about it, ranked.

Content-tier evals live at `evals/skills/dependency-checker/` and run in CI
(`.github/workflows/evals.yml`'s `skill-evals` job) on any PR that touches
this skill. The section 2 diagram example in `references/report-template.md`
must use the `flowchart` Mermaid keyword (matching this repo's
`mermaid-diagram` skill), not the older `graph` keyword — the grounding gate
in `evals/skills/dependency-checker/dependency-checker.cases.ts` checks for
the literal string `flowchart`.

## Why a script does the data collection

This repo has 6 independently-managed packages (`server/`, `client/`,
`reviewer-core/`, `e2e/`, `mcp-server/`, `evals/`), each with its own
`package.json` and lockfile, and two different package managers in play
(`pnpm` for server/client/evals, `npm` for the rest — see root `AGENTS.md`).
Getting install size, `outdated`, and `audit` right per package means
picking the right binary, tolerating exit codes that are *supposed* to be
non-zero (both `outdated` and `audit` exit 1 when they find something —
that's not a failure), and handling a package that was never `install`ed at
all. That's exactly the kind of repetitive, easy-to-get-subtly-wrong work a
script should own rather than being re-derived from scratch, so
`scripts/collect-deps.mjs` does it once, deterministically, and hands back
one clean JSON object per package. Read the report template
(`references/report-template.md`) for what to do with that JSON — this file
covers the workflow to get there.

## Workflow

### 1. Scope the run

Default to all 6 packages. If the user names one or more specific packages
("check client's dependencies", "how heavy is reviewer-core"), scope to
just those — don't run the full repo when they asked about one package.

Confirm the package list against reality before running anything — `ls
*/package.json` from the repo root, or check root `AGENTS.md`'s package
table — since new packages get added (this repo picked up `evals/` after
the table was last written) and the script will fail loudly on a stale
name rather than silently skip it, which is what you want.

Never touch `server/clones/**` — it's a full clone of a user's repo
(possibly dev-digest itself) living inside `server/`, gitignored, and not
one of this repo's own packages. It has its own `node_modules` and
lockfiles that have nothing to do with this analysis.

### 2. Collect data per package

For each scoped package, run:

```bash
node .claude/skills/dependency-checker/scripts/collect-deps.mjs <package-dir>
```

This needs the repo's normal Node setup (`nvm use stable` if the shell
doesn't already have Node ≥22 on PATH — see the project's own conventions
for this). The `outdated` and `audit` subcommands reach out to the
package manager's registry (that's how registries expose advisory and
version data — there's no local-only source for it); everything else
(sizes, dependency lists) is fully local. If a package's registry calls
fail (offline, registry down), the script surfaces that as an `error`
field per section instead of crashing — carry that into the report as an
explicit "did not run" note (see the template) rather than reporting zero
findings, which would misrepresent a data gap as a clean bill of health.

Pass `--with-depcheck` only if the user specifically asked about unused
dependencies — it only works when `depcheck` is already installed locally
in that package (it won't fetch it over the network) and adds real runtime
per package, so it's opt-in rather than default.

If a package has no `node_modules` (this repo doesn't install every
package by default — `e2e/` commonly doesn't have one until a browser flow
run installs it), the script reports `hasNodeModules: false` and skips
size/outdated/audit for it rather than erroring. Say this plainly in the
report instead of leaving a blank — a missing size row reads as "0 MB",
which is misleading.

### 3. Work out the internal dependency graph

The per-package script output tells you sizes and external deps, but not
how the packages relate to *each other* — that needs a quick look at the
code, since this repo has no workspace manifest to read it from:

- Grep each package's `src/` for imports of `@devdigest/shared` — that's
  the one contract package meant to be shared, vendored into both
  `server/src/vendor/shared/` and `client/src/vendor/shared/`.
- Check each `tsconfig.json` for path aliases pointing at another package's
  source (e.g. how `reviewer-core` gets consumed as source, per root
  `AGENTS.md`) — those are real dependency edges even though no
  `package.json` declares them.
- `mcp-server` is described in its own docs as a thin HTTP client to
  `server`'s API — that's a runtime dependency, not an import, and belongs
  in the graph as a labeled edge, not a node_modules-style link.

This is the graph developers actually want (section 2 of the template) —
draw it with `mermaid-diagram` conventions if you need a refresher on
Mermaid syntax.

### 4. Write the report

Follow `references/report-template.md` section-for-section — it's the
fixed structure this skill promises (executive summary → graph → per-package
breakdown → heaviest deps → vulnerabilities → outdated → unused →
prioritized recommendations). Keep every section even when empty ("None
found.") so the shape stays predictable across runs — a developer
skimming a second report should find the same headings in the same order.

Save to `docs/dependency-report.md` at the repo root, overwriting any
previous run (it's meant to reflect current state, not accumulate history —
git already keeps the history if anyone wants to diff runs). Stamp the
generation date and scope at the top.

Don't dump the full raw JSON from the collection script into the report —
that defeats the "scannable" requirement this skill exists to satisfy.
Tables and ranked lists only; if a table would run past ~20 rows, show the
top N and say how many more exist.

### 5. Close with prioritization, not just data

Section 8 (prioritized recommendations) is the part a developer actually
acts on — don't let it become a restatement of section 5-6's tables. Each
item needs a *reason* tied to real cost or risk (a critical CVE with a fix
one command away outranks a minor version bump every time) and a concrete
next action, not "consider upgrading X." The template's ordering heuristic
covers the common cases (fixable critical/high vuln → P0, unfixable
critical/high or major-behind → P1, heavy-but-replaceable or narrow-use →
P2) — use judgment beyond it when a finding doesn't fit neatly, but always
say *why* something outranks something else.

## After finishing

Per this repo's `AGENTS.md`, if anything non-obvious came up while running
this (a package manager quirk, an audit/registry failure worth remembering,
a graph edge that wasn't where you expected), record it in the root
`INSIGHTS.md` via the `engineering-insights` skill. Skip it if the run was
routine — an updated report is not itself an insight.
