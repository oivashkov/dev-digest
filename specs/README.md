# specs/ — cross-package

Forward-looking specs for work that spans more than one package. One file per
feature: `NN-feature-name.md`. Work that lives inside a single package goes in
that package's `specs/` instead (`e2e/` is the one exception — see its own
`specs/README.md`: written specs for `e2e/` live in `e2e/docs/`).

A spec describes **what to build and why it is done** — not how the code works
today (that is `docs/`) and not what we already rejected (that is `INSIGHTS.md`).

Authored by the `specreator` subagent (see `.claude/agents/specreator.md`) —
give it a feature name, which package(s) it touches, and whatever design
sources exist (screenshots pasted into the conversation, a text description, a
Figma link, an existing page/module to read as the baseline). It analyzes those
for missing states, uncovered edge cases, and unclear cross-module contracts,
and puts every gap it finds back to you as a question or a proposal — it never
resolves one silently. A human can also write or edit a spec directly; the
agent is a tool for it, not a gate.

Fixed shape — every spec uses exactly this template:

```markdown
# Spec: <Feature name>
Spec ID: SPEC-NN-feature-name
Status: draft | approved | implemented
Supersedes: <path to specs/NN-old-feature.md, or "none">

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

`Spec ID: SPEC-NN-feature-name` always mirrors the filename's number and slug
(`03-blast-radius.md` ⇔ `SPEC-03-blast-radius`), numbered per `specs/` folder
(this one is its own sequence, separate from any module's) — the slug is
there so the ID alone is recognizable without opening the file. A spec starts at `Status: draft`; only a human
promotes it to `approved` (agreed to build) or `implemented` (shipped) —
`specreator` never sets either itself. When a new spec replaces a decision an
older one made, set the new file's `Supersedes:` and add a one-line pointer at
the top of the old file rather than rewriting it — see `specreator.md` §8.

**Acceptance criteria use EARS**, with triggers written bilingually and
`shall` kept bracketed as the mandatory-requirement marker:

- Event-driven: `WHEN (КОЛИ) <trigger>, the system shall (shall) <response>.`
- State-driven: `WHILE (ПОКИ) <state holds>, the system shall (shall) <response>.`
- Unwanted behavior: `IF (ЯКЩО) <condition>, THEN the system shall (shall) <response>.`
- Optional feature: `WHERE (ДЕ) <feature enabled>, the system shall (shall) <response>.`
- Ubiquitous: `The system shall (shall) <response>.` (no trigger)

This bilingual-trigger form is a local course convention layered on top of
EARS, not an EARS requirement itself — the rest of the spec stays plain
English prose.

Once implemented, either delete the spec or set `Status: implemented` and move
any durable explanation into `docs/`. Stale specs are worse than missing ones —
an agent reads them as current intent.
