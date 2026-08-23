# mcp-server/specs

One file per MCP-server feature: `NN-feature-name.md`. `mcp-server-plan.md`
predates this convention (it is the original Development Plan for the
package, not a spec in this shape) and stays as-is.

Authored by the `specreator` subagent (`.claude/agents/specreator.md`) or
directly by hand. Uses the repo-wide template — see the root
`../../specs/README.md` for the full shape, the EARS acceptance-criteria
convention, and the `Status`/`Supersedes` lifecycle:

```markdown
# Spec: <Feature name>
Spec ID: SPEC-NN-feature-name
Status: draft | approved | implemented
Supersedes: <path, or "none">

## Problem & user
## Goals / Non-goals
## User stories
## Acceptance criteria (EARS)
## Edge cases
## Non-functional requirements
## Inputs and provenance
## Untrusted inputs
## Open questions
```

Module-specific things a mcp-server spec's Acceptance criteria / Non-functional
requirements should account for: which MCP tool(s) it adds or changes
(`list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`,
`get_blast_radius`, or a new one), the three-layer split (presentation tool →
application service → the single HTTP adapter to `server/`'s API), and
whether it needs a new field on the thin HTTP client rather than reaching
into `server/` internals directly (it never does).
