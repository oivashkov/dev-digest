# server/specs

One file per server-side feature: `NN-feature-name.md`. Anything that also
changes the UI belongs in the root `../../specs/` instead.

Authored by the `specreator` subagent (`.claude/agents/specreator.md`) or
directly by hand. Uses the repo-wide template — see the root `../../specs/README.md`
for the full shape, the EARS acceptance-criteria convention, and the
`Status`/`Supersedes` lifecycle:

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

Module-specific things a server spec's Acceptance criteria / Non-functional
requirements should account for: which route(s) it needs and which
`@devdigest/shared` schema backs them, any `db/schema.ts` change (remember:
`pnpm db:generate`, never hand-write a migration), and whether it needs a new
adapter behind the DI container. Most features land as a new
`src/modules/<name>/` plugin — say which module the spec creates or extends.
