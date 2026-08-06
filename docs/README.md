# docs/ — cross-package

Reference material describing how the system works **today**, across more than
one package. Human-first prose and diagrams; agents read it on demand via the
`Read when` pointers in `../AGENTS.md`.

| Path             | What                                                         |
| ---------------- | ------------------------------------------------------------ |
| `agent-prompts/` | System prompts for the built-in reviewers + model choice notes |
| `plans/`         | Cross-package feature designs, kept after shipping as a historical decision + incident record (e.g. why GitLab support is shaped the way it is) |

Package-local reference material goes in `<package>/docs/`.

Rules:

- Do not restate `README.md`. Link to it.
- Do not put intent here — that is `specs/`. Do not put rejected approaches here
  — that is `INSIGHTS.md`.
- If a doc goes stale, delete it. A wrong doc costs more than a missing one,
  because `AGENTS.md` points agents at it as curated truth.
