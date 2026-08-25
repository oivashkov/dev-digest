# client/specs

One file per UI feature: `NN-feature-name.md`. If it also needs a new endpoint,
put the spec in the root `../../specs/` so both sides stay in one document.

Authored by the `spec-creator` subagent (`.claude/agents/spec-creator.md`) or
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

Module-specific things a client spec's Acceptance criteria / Edge cases should
account for: which `src/app/**/page.tsx` route(s) it needs, which hook in
`src/lib/hooks` (and endpoint) supplies its data, every UI state
(loading/empty/error/success — `spec-creator` checks pasted screenshots against
this list), and which `messages/<locale>/*.json` keys it adds.
