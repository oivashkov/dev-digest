# e2e/docs

How the suite works today, plus **written specs for this package** — note that
`../specs/` is already taken by executable flow files, so prose specs live here.

Good candidates: the hermetic runner's port map and teardown, the agent-browser
command vocabulary we actually use, debugging a flow from raw stderr, what the
seed guarantees and which flows depend on it.

Not here: the flow format walkthrough (that is `../README.md`), rejected
approaches (`../INSIGHTS.md`).

## Written specs

A feature spec for `e2e/` (as opposed to the how-it-works content above) is
`NN-feature-name.md`, authored by the `spec-creator` subagent
(`.claude/agents/spec-creator.md`) or directly by hand, using the repo-wide
template — see `../../specs/README.md` for the full shape, the EARS
acceptance-criteria convention, and the `Status`/`Supersedes` lifecycle. This
is the one package where a written spec lives under `docs/` instead of
`specs/`.
