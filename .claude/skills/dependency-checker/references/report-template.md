# Report template

Fill this exact skeleton in when writing `docs/dependency-report.md`. Keep
every section — if a section has nothing to say (e.g. no vulnerabilities
found), keep the heading and write "None found." under it rather than
omitting it; a developer scanning the file relies on the section order
being stable across runs.

Replace bracketed placeholders. Tables are illustrative shapes, not fixed
column sets — add a column if the data supports it (e.g. a "used by" column
in the heaviest-deps table), drop one only if no package ever populates it.

````markdown
# Dependency report — dev-digest

_Generated: [YYYY-MM-DD] · Scope: [all 6 packages | <package name>]_

## Scope

Packages analyzed this run: [list every package actually scoped in step 1,
e.g. "server, client, reviewer-core, e2e" — omit any of the 6 that weren't
in scope, and say so explicitly if the run was narrowed to fewer than all
6, e.g. "mcp-server and evals excluded — run scoped to server/client only"].

## 1. Executive summary

One paragraph: total installed footprint across scoped packages, worst
vulnerability severity found, how many packages have `node_modules`
missing (data gap, not "healthy"), and the single most actionable finding.

| Package | Manager | Prod / Dev / Peer | Installed size | Vulnerabilities (C/H/M/L) | Outdated |
| ------- | ------- | ------------------ | --------------- | -------------------------- | -------- |
| server | pnpm | 12 / 8 / 0 | 340 MB | 0/1/2/0 | 5 |
| ... | | | | | |

## 2. Dependency graph

A single Mermaid diagram covering:
- Each of the 6 packages as a node/subgraph.
- Internal edges: which package imports another's published contract
  (`@devdigest/shared`) or vendors code from it (`src/vendor/*`) — this is
  the graph a developer actually needs, not node_modules cross-linking
  (there isn't any; this repo is not a workspace).
- Each package's 2-3 heaviest *direct* external dependencies as leaf nodes,
  so the diagram also communicates "what pulls its weight" at a glance —
  don't try to draw the full transitive tree, it will be unreadable.

```mermaid
flowchart LR
  subgraph server [server (pnpm)]
    server_shared["@devdigest/shared (vendored)"]
  end
  subgraph client [client (pnpm)]
    client_shared["@devdigest/shared (vendored)"]
  end
  subgraph reviewer_core [reviewer-core (npm)]
  end
  ...
  server -->|imports contracts from| server_shared
  client -->|imports contracts from| client_shared
```

## 3. Per-package breakdown

One subsection per package, in the order it was collected. If a package's
`node_modules` was missing, say so at the top of its subsection instead of
guessing at sizes.

### [package name] ([pnpm|npm])

- Installed size: [X MB] · Prod deps: [N] · Dev deps: [N] · Peer deps: [N]

| Dependency | Type | Size |
| ---------- | ---- | ---- |
| [name] | prod | [X MB] |
| ... | | |

(List direct dependencies only — prod first sorted by size desc, then dev.
If a package has more than ~20 direct deps, show the top 10 by size and
note "+N more, see raw data" rather than dumping the full list.)

## 4. Heaviest dependencies (repo-wide)

Top 15 direct dependencies by installed size, across every scoped package,
deduplicated by name — a dependency pulled in by 3 packages should show
once with all 3 in "Used by", not 3 separate rows.

| Dependency | Size (largest install) | Used by | Type |
| ---------- | ------------------------ | ------- | ---- |
| [name] | [X MB] | server, client | prod |
| ... | | | |

## 5. Vulnerabilities

Sorted critical → high → moderate → low. One row per advisory, not per
affected package, unless severities differ per package (then split the
row).

| Severity | Dependency | Affected package(s) | Fix available | Advisory |
| -------- | ---------- | -------------------- | -------------- | -------- |
| Critical | [name] | server | Yes (`pnpm audit fix`) | [title/CVE if present] |
| ... | | | | |

If `npm audit`/`pnpm audit` failed for a package (e.g. registry
unreachable), note it here explicitly: "**[package]: audit did not run —
[reason]. Vulnerability counts below exclude it.**"

## 6. Outdated dependencies

Sorted by semver gap (major first — that's the one that needs a decision,
not just a bump), then by package.

| Dependency | Package(s) | Current | Wanted | Latest | Gap |
| ---------- | ----------- | ------- | ------ | ------ | --- |
| [name] | mcp-server | 22.20.1 | 22.20.1 | 26.3.0 | major |
| ... | | | | | |

## 7. Unused dependencies

Only populated if depcheck was actually run (`--with-depcheck`). Otherwise:

> Not checked this run. Unused-dependency detection needs `depcheck`
> installed locally in each package (`npm i -D depcheck` / `pnpm add -D
> depcheck`) and adds real runtime per package — re-run with
> `--with-depcheck` if you want this section populated.

| Package | Declared but unused | Used but undeclared |
| ------- | --------------------- | --------------------- |
| [name] | [dep, dep] | [dep] |

## 8. Prioritized recommendations

Ranked list, most actionable/highest-risk first. Every item names the
affected package(s) and a concrete next step — never a vague "consider
updating." Group by priority tier; a tier with nothing in it can be
dropped (unlike the sections above, this one only shows what applies).

**P0 — do before the next release**
1. **[Package]: [issue].** [Why it matters in one sentence]. → `[exact command or action]`

**P1 — schedule soon**
1. ...

**P2 — opportunistic / when touching that code anyway**
1. ...

Ordering heuristic for what counts as P0 vs P1 vs P2:
- Critical/high vulnerability with a fix available → P0.
- Critical/high vulnerability with *no* fix available → P1 (needs a
  decision — replace the package or accept the risk — not a blind bump).
- Major-version-behind on a widely-used direct dependency → P1.
- Heavy dependency (top of section 4) with a lighter drop-in replacement,
  or a dependency only used in one narrow spot → P2.
- Minor/patch-only outdated deps with no vulnerability → P2 or omit
  entirely if the list is long; don't let routine patch bumps drown out
  the findings that actually need a human decision.

## 9. Summary

The report's last section, always — 3 to 5 bullets, ordered highest-priority
first, each one sentence, each naming the specific package/dependency (not a
restatement of section 8's line items verbatim, a step back to "if you read
nothing else, do these"). If section 8 has fewer than 3 P0/P1 items total,
pull the highest-value P2s to fill it rather than padding with "no action
needed" — a running report always closes with 3-5 real takeaways.

1. [Package/dependency]: [one-sentence takeaway]. → `[concrete next step]`
````
