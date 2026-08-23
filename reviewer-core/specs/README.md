# reviewer-core/specs

One file per engine change: `NN-feature-name.md`.

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

Module-specific things a reviewer-core spec's Non-functional requirements
should account for: which prompt slot in `assemblePrompt` it adds or changes,
what `src/index.ts` starts exporting and who consumes it, its effect on what
survives the grounding gate, and whether it stays reproducible under a
stubbed `LLMProvider`. Two constraints every spec here must respect: the
package stays **pure** (no DB, GitHub, or filesystem), and the **grounding
gate keeps its veto**. A spec that needs either broken belongs in
`../../server/specs/` instead.
