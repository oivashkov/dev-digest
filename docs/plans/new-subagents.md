# Four new pipeline subagents: test-writer, architecture-reviewer, plan-verifier, doc-writer

Status: **proposed 2026-08-17**, not yet implemented. Produced by the
`planner` subagent from a request to extend the existing
`researcher → planner → implementer` conveyor in `.claude/agents/` with four
specialized agents, informed by 5 parallel external-research passes (sources
at the bottom).

## 1. Summary

Add four new Claude Code subagents under `.claude/agents/`, in the exact same
format as `researcher.md` / `planner.md` / `implementer.md` (YAML frontmatter
`name`/`description`/`tools`/`model`/`skills` + markdown system prompt), and
extend the two shared catalog artifacts (`README.md`, `diagrams.md`) to
describe the enlarged pipeline. The four agents specialize the existing flow
into a richer conveyor: a **test-writer** (writes UI + backend tests per repo
conventions), an **architecture-reviewer** (read-only boundary auditor with
evidence-grounded findings), a **plan-verifier** (read-only Development-Plan-
vs-code conformance, strictly scoped, not a code review), and a **doc-writer**
(turns plans/implemented features into `docs/` content with Mermaid diagrams).
No agent gets `Agent` (none spawn sub-agents); write access is granted only to
the two agents that produce artifacts, and scoped by prompt.

## 2. Context reviewed

- `.claude/agents/planner.md:15-40` — canonical frontmatter shape and the
  `skills:` preload list this plan mirrors; §0–§8 section skeleton for a
  read-only agent.
- `.claude/agents/implementer.md:19-21` — the write-capable frontmatter
  (`tools: Read, Write, Edit, Grep, Glob, Bash, Skill`) and Implementation-
  Report pattern to mirror for test-writer/doc-writer.
- `.claude/agents/researcher.md:4-5` — precedent for an agent whose `skills:`
  list is omitted entirely (researcher preloads none).
- `.claude/agents/README.md:20-60` — Ukrainian catalog table (`Агент | Модель
  | Дозволи | Відповідальність`) + per-agent detail sections + a paragraph
  that hard-codes the current count of three agents; all must be updated.
- `.claude/agents/diagrams.md:1-61` — two Mermaid diagrams (handoff flow +
  Type→Skills), both currently three-agent; both need extension.
- `TESTING.md` (root) — the authority test-writer's prompt must cite for
  backend suites: `.it.test.ts` = DB-backed via testcontainers, everything
  else hermetic; `src/adapters/mocks.ts` for `MockLLMProvider`/`MockGitClient`;
  CI path-filtered per package.
- `AGENTS.md` (root) — search order `specs/` → `docs/` → `INSIGHTS.md` →
  source; per-module onion/hooks/LLMProvider conventions each reviewer must
  encode; `engineering-insights` mandatory at task end.
- `.claude/skills/mermaid-diagram` — exists; doc-writer and the diagrams step
  cite/preload it (`mermaid-diagram` owns `**/*.md` per
  `skill-scope-map.md`).
- `server/package.json:25` — `dependency-cruiser` present as a dependency but
  unconfigured/unwired (no config file, no `depcruise` script, no CI usage).

### External practices folded in (5 researcher reports, retrieved 2026-08-17)

- **test-writer:** AI-test failure modes to prohibit in-prompt — tautological
  asserts (`toBeDefined()`), mirrored logic, over-mocking (never mock the unit
  under test), happy-path-only, snapshot-overuse, unseeded randomness/unfrozen
  time; RTL query priority (`getByRole` > `getByTestId`), `userEvent` over
  `fireEvent`; testcontainers for anything touching SQL/schema/dialect.
  Mutation testing (Stryker) mentioned only as a *recommendation*, not a repo
  fact — confirmed absent from every `package.json`.
- **architecture-reviewer:** official read-only reviewer pattern = **omit
  `Agent`** from tools; every finding needs concrete `file:line` + real
  import/call-chain crossing a forbidden boundary (back-call / skip-call /
  cyclic / duplicate-functionality typology); an explicit "what NOT to
  report" list to cut false positives; structured severity output
  (Critical/Warning/Suggestion), enforced at prompt level only (no
  JSON-schema in CLI subagents).
- **plan-verifier:** requirements-traceability matrix (each plan item ↔
  concrete artifact); state taxonomy Done / Missing / Partial /
  Silently-descoped-with-reason; maker-checker (the writer does not certify
  itself); scoped strictly to "was the promise met", explicitly not debating
  implementation choices when acceptance criteria are already clear; a plan
  item closes only when a concrete artifact (file/test/line) is named — no
  silent LGTM.
- **doc-writer:** Diataxis 4-type split as the heuristic for *where* content
  goes (tutorial/how-to/reference/explanation); docs-as-code (same PR as the
  code); diagrams-as-code (Mermaid, diff-able) with the "if it doesn't fit an
  A4 sheet, use prose" heuristic; do-not-duplicate — link the canonical
  `specs/`/plan instead of copying it.

## 3. Modules affected

| Module | Package manager | Why touched |
|---|---|---|
| `.claude/agents/` | none (rules/config package, not a code package) | 4 new agent definition files + updates to the shared `README.md` and `diagrams.md` |

No source package (`server/`, `client/`, `reviewer-core/`, `e2e/`) is modified
by this plan. The new agents *describe* how future work in those packages is
done; they do not change them.

## 4. Architectural constraints

- **Least-privilege tools:** read-only agents (`architecture-reviewer`,
  `plan-verifier`) MUST omit `Write`, `Edit`, and `Agent`; write-capable
  agents (`test-writer`, `doc-writer`) get `Write`/`Edit` but MUST scope them
  by prompt (test-writer → test files only; doc-writer → `docs/` + `specs/`
  only, never `src/`). None of the four gets `Agent` — no spawning. None gets
  `WebFetch`/`WebSearch` — external unknowns are handed back to `researcher`,
  matching the existing `implementer` boundary.
- **Format parity:** each new file MUST follow the existing agent skeleton
  (frontmatter + numbered `##` sections), and its `description` MUST be
  action-oriented with an explicit "Use for X" trigger so the orchestrator
  routes correctly. Prompt bodies stay **English** (parity with
  `researcher`/`planner`/`implementer`); the two catalog files stay
  **Ukrainian** (parity with current `README.md`/`diagrams.md`).
- **No JSON-schema output enforcement:** structured output for these CLI
  subagents is prompt-level section templates only (a fixed report
  skeleton), not a machine schema.
- **Reviewers encode, not re-derive, the repo's boundary rules:**
  architecture-reviewer's checks must cite the actual conventions — server
  onion layering (routes→service→repository, `container.vcsFor(repo)` not
  direct `container.github()`), client hooks-only data access, reviewer-core
  `LLMProvider` injection + mandatory `groundFindings()` gate.
- **plan-verifier stays in its lane:** checks plan-item ↔ artifact coverage
  only; explicitly does NOT perform architecture review (architecture-
  reviewer's job) or general code review.
- **doc-writer routing rule:** must know which `docs/` target each content
  kind goes to (root `docs/README.md` vs per-module
  `server|client|reviewer-core|e2e/docs/README.md` reference; decisions →
  `INSIGHTS.md` via `engineering-insights`; plans → `specs/`), and must link
  the canonical `specs/`/plan rather than copy it.
- **New Type label:** these steps are not `backend`/`ui`/`core`/`e2e` —
  introduce a plan-local Type **`agent-definition`**. Skill emphasis:
  `engineering-insights` always; `mermaid-diagram` for the doc-writer file
  and the `diagrams.md` step.

## 5. Steps

### Step 1: `test-writer` agent definition
- **Type:** agent-definition
- **Module/package:** `.claude/agents/` (none)
- **Owned paths:** new: `.claude/agents/test-writer.md`
- **What changes:** Frontmatter: `name: test-writer`; action-oriented
  `description` ("write/add tests for a completed backend or UI change… Use
  for 'write tests for X'"); `tools: Read, Write, Edit, Grep, Glob, Bash,
  Skill`; `model: sonnet`; `skills:` = `react-testing-library,
  typescript-expert, security, engineering-insights`. Body sections: (0)
  clarify if the code-under-test/target suite is ambiguous; (1) tools & scope
  — Write/Edit scoped to test files (`*.test.tsx`, `*.test.ts`,
  `*.it.test.ts`) and fixtures only, never production `src/`; Bash allowed to
  *run* the package's test/typecheck script but NOT to install deps, run
  `db:migrate`, or mutate state; (2) suite-selection rules citing
  `TESTING.md` — RTL+jsdom for `client/`, hermetic vitest for server-unit,
  `*.it.test.ts`+testcontainers for DB/schema/dialect logic,
  `MockLLMProvider`/`MockGitClient` from `src/adapters/mocks.ts`,
  `reviewer-core` npm unit, e2e hermetic batch JSON; (3) test-quality bar (no
  tautological asserts, no mirrored logic, no over-mocking the SUT, no
  happy-path-only, seed randomness/freeze time, RTL `getByRole`>`getByTestId`,
  `userEvent`>`fireEvent`); (4) "Test Implementation Report" output template
  (files added, exact suite command run + pass/fail, use-case-coverage
  rationale, mocking boundaries, anti-patterns avoided); final
  `engineering-insights` step.
- **Skills the implementer will apply:** `engineering-insights` (always);
  content-grounding from `react-testing-library`, `typescript-expert`,
  `security`
- **Depends on:** none
- **Tests to run/add:** none runnable (Markdown definition). Done = file
  parses as a valid agent (frontmatter keys match existing agents) and
  prompt covers backend + UI suites per `TESTING.md`.

### Step 2: `architecture-reviewer` agent definition
- **Type:** agent-definition
- **Module/package:** `.claude/agents/` (none)
- **Owned paths:** new: `.claude/agents/architecture-reviewer.md`
- **What changes:** Frontmatter: `name: architecture-reviewer`;
  action-oriented `description` ("audit a diff/module for
  architectural-boundary violations with evidence… Use for 'check the
  architecture/layering of X'"); `tools: Read, Grep, Glob, Bash` (read-only;
  **no** `Write`/`Edit`/`Skill`/`Agent`); `model: sonnet`; `skills:` =
  `backend-onion-architecture, frontend-architecture, typescript-expert,
  security, engineering-insights`. Body sections: (0) clarify target scope;
  (1) read-only boundaries; (2) the boundary rules to enforce, grouped per
  module (server onion direction + `container.vcsFor` rule; client
  hooks-only/`fetch` ban; reviewer-core `LLMProvider` injection +
  `groundFindings()` gate) with the back-call/skip-call/cyclic/duplicate
  typology; (3) evidence requirement — every finding = `file:line` + the
  actual offending import/call-chain, never generic advice; (4) explicit
  "what NOT to report" list (pure style, hypotheticals, accepted deviations
  already recorded in `server/INSIGHTS.md`); (5) "Architecture Review" output
  template — findings grouped Critical/Warning/Suggestion, each with
  evidence + violated layer rule + confidence.
- **Skills the implementer will apply:** `engineering-insights` (always);
  content-grounding from `backend-onion-architecture`,
  `frontend-architecture`, `security`, `typescript-expert`
- **Depends on:** none
- **Tests to run/add:** none runnable. Done = file parses; tools line
  contains no write/spawn capability; prompt enforces evidence-per-finding
  and lists accepted deviations to suppress.

### Step 3: `plan-verifier` agent definition
- **Type:** agent-definition
- **Module/package:** `.claude/agents/` (none)
- **Owned paths:** new: `.claude/agents/plan-verifier.md`
- **What changes:** Frontmatter: `name: plan-verifier`; action-oriented
  `description` ("verify implemented code fulfils every item of a
  Development Plan / requirements… Use for 'did we build what the plan
  promised'"); `tools: Read, Grep, Glob, Bash` (read-only; no
  write/skill/agent); `model: sonnet`; `skills:` = `engineering-insights,
  typescript-expert`. Body sections: (0) clarify — requires the plan/
  requirements as input (maker-checker: it gets the plan, not the
  generator's reasoning); (1) read-only boundaries; (2) method — build a
  requirements-traceability matrix, each plan item → concrete artifact
  (`file:test:line`); (3) state taxonomy Done / Partial / Missing /
  Silently-descoped-with-reason, plus gold-plating (artifact with no
  matching plan item); (4) strict scope guardrail — NOT a code review, NOT
  an architecture review; do not debate implementation choices when
  acceptance criteria are already met; a "silent LGTM" (item closed without
  a named artifact) is forbidden; (5) "Plan Verification" output template —
  the traceability table + an overall verdict listing any orphan
  requirements/coverage gaps.
- **Skills the implementer will apply:** `engineering-insights` (always);
  `typescript-expert` for reading artifacts
- **Depends on:** none
- **Tests to run/add:** none runnable. Done = file parses; prompt is scoped
  to plan-conformance only and explicitly defers architecture/code-quality
  to the other reviewers.

### Step 4: `doc-writer` agent definition
- **Type:** agent-definition
- **Module/package:** `.claude/agents/` (none)
- **Owned paths:** new: `.claude/agents/doc-writer.md`
- **What changes:** Frontmatter: `name: doc-writer`; action-oriented
  `description` ("document an implemented feature / turn a plan into docs
  with diagrams… Use for 'document X', 'write docs for X'"); `tools: Read,
  Write, Edit, Grep, Glob, Bash, Skill`; `model: sonnet`; `skills:` =
  `mermaid-diagram, engineering-insights`. Body sections: (0) clarify what to
  document + which audience; (1) tools & scope — Write/Edit restricted to
  `docs/` (root + per-module) and `specs/`, never `src/` or code; (2)
  content-routing table using Diataxis mapped to repo targets: reference
  "how it works" → `<module>/docs/README.md`; cross-package topic → root
  `docs/README.md`; decisions/rejected-approaches → `INSIGHTS.md` via
  `engineering-insights` (not docs); plans → `specs/`; (3) diagram rules —
  Mermaid via the `mermaid-diagram` skill, diagram must not duplicate prose,
  drop it if it won't fit "an A4 sheet"; (4) do-not-duplicate — link the
  canonical `specs/`/plan rather than copy it, docs-as-code (same change-set
  as the feature); (5) "Documentation Report" output template — files
  written/updated with their Diataxis type + target rationale, diagrams
  added, canonical links referenced.
- **Skills the implementer will apply:** `mermaid-diagram` (this step
  authors diagrams), `engineering-insights` (always)
- **Depends on:** none
- **Tests to run/add:** none runnable. Done = file parses; Write scope is
  limited to `docs/`+`specs/`; prompt includes the Diataxis→target routing
  table.

### Step 5: Update agent catalog `README.md`
- **Type:** agent-definition
- **Module/package:** `.claude/agents/` (none)
- **Owned paths:** modified: `.claude/agents/README.md`
- **What changes:** Add the four agents to the `Каталог` table
  (`README.md:22-26`) with their model + tools + one-line responsibility;
  add a per-agent detail section for each (Відповідальність / Дозволи /
  Модель / Вхід / Вихід), mirroring the existing sections; update the
  "Типовий конвеєр" paragraph (`README.md:8-13`) and the paragraph that
  currently hard-codes three agents (`README.md:28-31`) to reflect seven
  agents and note which are read-only (architecture-reviewer, plan-verifier)
  vs write-scoped (test-writer→tests, doc-writer→docs/specs). All content in
  Ukrainian.
- **Skills the implementer will apply:** `engineering-insights` (always)
- **Depends on:** Steps 1–4 (describes files that must already exist; not
  parallel-safe with them). Parallel-safe with Step 6 (disjoint file).
- **Tests to run/add:** none runnable. Done = every one of the seven agents
  appears once in the catalog table with an accurate tools/model row, and
  the summary paragraphs no longer say "three".

### Step 6: Extend pipeline `diagrams.md`
- **Type:** agent-definition (mermaid-emphasis)
- **Module/package:** `.claude/agents/` (none)
- **Owned paths:** modified: `.claude/agents/diagrams.md`
- **What changes:** Extend the handoff flowchart (`diagrams.md:8-19`) to
  place the four new agents in the conveyor — e.g. implementer → test-writer,
  implementer → architecture-reviewer + plan-verifier (read-only gates),
  implementer/plan → doc-writer — with the same edge-label style; extend/
  annotate the Type→Skills diagram (`diagrams.md:31-53`) to include the new
  `agent-definition` Type and its `engineering-insights` (always) +
  `mermaid-diagram` (docs) emphasis. Keep both diagrams within the "fits an
  A4 sheet" heuristic; split into two if a single flowchart becomes
  unreadable. Ukrainian labels.
- **Skills the implementer will apply:** `mermaid-diagram` (authoring the
  diagram), `engineering-insights` (always)
- **Depends on:** Steps 1–4 (diagrams reference the new agents by name/role).
  Parallel-safe with Step 5 (disjoint file).
- **Tests to run/add:** none runnable. Done = both Mermaid blocks render
  (valid syntax) and every new agent appears in the handoff diagram; the
  Type→Skills diagram shows `agent-definition`.

**Parallelism:** Steps 1–4 have disjoint Owned paths and no dependencies →
four `implementer` instances can run them in parallel. Steps 5 and 6 each
depend on 1–4 but are disjoint from each other → they can run in parallel
with one another once 1–4 land.

## 6. Cross-cutting concerns

- **Ordering, not contracts:** the only sequencing is that the two catalog
  artifacts (Steps 5–6) must land after the four agent files (Steps 1–4),
  because they name and summarize those files.
- **Tools-allowlist consistency:** all four `description` fields + tools
  lines should be cross-checked against the pattern set by
  `researcher`/`planner`/`implementer` so orchestrator routing and the
  README table stay in sync.
- **`engineering-insights` at task end:** whoever implements these steps
  records any non-obvious agent-authoring decisions into the root
  `INSIGHTS.md`, e.g. the read-only-omit-`Agent` pattern.

## 7. Out of scope / explicitly deferred

- **Wiring `dependency-cruiser` into a runnable lint/CI gate.** Installed
  (`server/package.json:25`) but unconfigured. architecture-reviewer is a
  *read-and-reason* auditor (grep/read import chains), not a tool-runner.
  Authoring a `.dependency-cruiser.js` ruleset + `depcruise` script + CI step
  is a separate task.
- **Adding Stryker / mutation testing to any package.** Not present in the
  repo. test-writer may *recommend* it in prose, but this plan does not add
  the dependency or a `TESTING.md` convention for it.
- **Changing `implementer.md`/`planner.md`/`researcher.md` themselves,** or
  the `pr-self-review` skill scope map, or any product-side
  `docs/agent-prompts/` (those are the built-in *reviewer* product agents, a
  different system from `.claude/agents/`).
- **Any change to `server/`, `client/`, `reviewer-core/`, `e2e/` source or
  their `package.json`s.**
- **Committing / opening a PR.** Left to the user.

## 8. Open questions / risks

- **Stryker (mutation testing) — resolved: absent.** Confirmed no `stryker`
  in any `package.json`. Framed in test-writer as a *suggestion* only.
- **architecture-reviewer tooling — resolved with a nuance.**
  `dependency-cruiser@^17.4.3` is a declared dep in `server/` but has no
  config, no script, no CI wiring. `ts-arch`/`archunit`/
  `eslint-plugin-boundaries` are absent. The reviewer reasons over imports/
  call-chains by reading, not by running an unconfigured tool. Whether to
  actually wire depcruise is deferred (§7).
- **test-writer Bash scope — resolved: read + test-run only.** No
  `db:migrate`, no dependency installs, no state mutation. `*.it.test.ts`
  suites spin up testcontainers Postgres themselves; the agent runs the
  suite, it does not provision infra manually.
- **Model choice (sonnet for all four) is a proposal, tunable.** The repo
  reserves `opus` for the orchestration-heavy `planner`; the four new agents
  are either writers (parity with `sonnet` `implementer`) or mechanical
  read-only auditors, for which official guidance recommends the cheaper
  model for routine/cost-sensitive work. If architecture-reviewer or
  plan-verifier produce too many false positives / missed traces in
  practice, bumping either to `opus` is a one-line change.
- **Ukrainian vs English for the four new prompt bodies:** decided as
  English (parity with existing three agent prompts), with only the two
  catalog artifacts in Ukrainian. Confirm with the user if a different
  convention is wanted.

## 9. Suggested review path (not performed here)

- Before PR: run the `pr-self-review` skill (per `AGENTS.md`). Its
  `skill-scope-map.md` routes `.md` changes to `mermaid-diagram` (for
  `diagrams.md`) and otherwise to general prose review.
- No auth/input/secrets touched → no dedicated security review needed.
- Light architecture sign-off worthwhile on the tools allowlists
  (least-privilege) and the read-only/write split.

## Sources (external research, retrieved 2026-08-17)

- Subagent design: [Create custom subagents — Claude Code Docs](https://code.claude.com/docs/en/sub-agents),
  [Get structured output from agents — Agent SDK Docs](https://code.claude.com/docs/en/agent-sdk/structured-outputs),
  [anthropics/claude-code#20625](https://github.com/anthropics/claude-code/issues/20625),
  [How we built our multi-agent research system — Anthropic](https://www.anthropic.com/engineering/built-multi-agent-research-system),
  [PubNub — Best practices for Claude Code subagents](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- Architecture conformance: [dependency-cruiser](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md),
  [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS),
  [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries),
  [fresh-onion](https://dev.to/remojansen/enforce-clean-architecture-in-your-typescript-projects-with-fresh-onion-45pi),
  [Symptoms of Architecture Erosion in Code Reviews (arXiv:2201.01184)](https://arxiv.org/abs/2201.01184),
  [Redefining measures of Layered Architecture (arXiv:2106.03079)](https://arxiv.org/pdf/2106.03079),
  [Cloudflare — Orchestrating AI Code Review at scale](https://blog.cloudflare.com/ai-code-review/),
  [read-only codebase audit prompt (gist)](https://gist.github.com/aarondfrancis/8735edbe48532f97ee5ea818db4dbd47),
  [Reducing False Positives in Static Bug Detection with LLMs (arXiv:2601.18844)](https://arxiv.org/html/2601.18844v1),
  [tsarch for AI Coding Agents — Angular Architects](https://www.angulararchitects.io/en/blog/architecture-beyond-layers-tsarch-for-ai-agents/)
- Test-writing: [Are Coding Agents Generating Over-Mocked Tests? (arXiv:2602.00409)](https://arxiv.org/html/2602.00409v1),
  [Reviewing AI-Generated Tests: A Code-Review Checklist](https://qaskills.sh/blog/reviewing-ai-generated-tests-checklist-2026),
  [Mutation Testing for AI-Generated Code — Augment Code](https://www.augmentcode.com/guides/mutation-testing-ai-generated-code),
  [Kent C. Dodds — How to know what to test](https://kentcdodds.com/blog/how-to-know-what-to-test),
  [Kent C. Dodds — The Testing Trophy](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications),
  [Kent C. Dodds — Testing Implementation Details](https://kentcdodds.com/blog/testing-implementation-details),
  [Testing Library docs — query priority](https://testing-library.com/docs/queries/about/#priority),
  [Testing Library docs — user-event](https://testing-library.com/docs/user-event/intro/),
  [dominik.info — You Probably Shouldn't Mock the Database](https://dominik.info/blog/mocking-the-database/),
  [Docker Blog — Testcontainers: Testing with Real Dependencies](https://www.docker.com/blog/testcontainers-testing-with-real-dependencies/)
- Plan verification: [Testomat.io — RTM Guide](https://testomat.io/blog/the-ultimate-guide-to-rtm-requirements-traceability-matrix/),
  [TestRail — Test Coverage vs. Traceability](https://www.testrail.com/blog/test-coverage-traceability/),
  [Nulab — DoD vs Acceptance Criteria](https://nulab.com/learn/software-development/definition-of-done-vs-acceptance-criteria/),
  [Spec Review Checklist Before Coding](https://spec-coding.dev/blog/spec-review-checklist-before-coding),
  [The "Stale Plan" Problem in Coding Agents](https://medium.com/@arijitdutta23/the-stale-plan-problem-in-coding-agents-cde2c741f8ab),
  [Adversarial Code Review — Augment Code](https://www.augmentcode.com/guides/adversarial-code-review),
  [ASDLC.io — Adversarial Code Review pattern](https://asdlc.io/patterns/adversarial-code-review/),
  [MindStudio — Verifier Pattern in Multi-Agent Systems](https://www.mindstudio.ai/blog/verifier-pattern-multi-agent-systems-independent-review),
  [AgentCoder (arXiv:2312.13010)](https://arxiv.org/pdf/2312.13010)
- Documentation: [Diátaxis](https://diataxis.fr/), [Diátaxis — Start here](https://diataxis.fr/start-here/),
  [Write the Docs — Docs as Code](https://www.writethedocs.org/guide/docs-as-code/),
  [Google styleguide — Documentation Best Practices](https://google.github.io/styleguide/docguide/best_practices.html),
  [C4 model — Diagrams](https://c4model.com/diagrams),
  [C4 model — Dynamic diagrams](https://c4model.com/diagrams/dynamic),
  [Martin Fowler — Architecture Decision Record](https://www.martinfowler.com/bliki/ArchitectureDecisionRecord.html),
  [GitHub Blog — Mermaid diagrams in Markdown](https://github.blog/developer-skills/github/include-diagrams-markdown-files-mermaid/),
  [Archbee — Using Diagrams in Software Documentation](https://www.archbee.com/blog/diagrams-in-developer-documentation),
  [Mintlify — How to Stop Documentation Drift](https://www.mintlify.com/library/how-to-stop-documentation-drift)

## Relevant file paths (all absolute)

- New: `/Users/o.ivashkov/projects/private/dev-digest/.claude/agents/test-writer.md`
- New: `/Users/o.ivashkov/projects/private/dev-digest/.claude/agents/architecture-reviewer.md`
- New: `/Users/o.ivashkov/projects/private/dev-digest/.claude/agents/plan-verifier.md`
- New: `/Users/o.ivashkov/projects/private/dev-digest/.claude/agents/doc-writer.md`
- Modified: `/Users/o.ivashkov/projects/private/dev-digest/.claude/agents/README.md`
- Modified: `/Users/o.ivashkov/projects/private/dev-digest/.claude/agents/diagrams.md`
- Format references: `.claude/agents/planner.md`, `.claude/agents/implementer.md`, `.claude/agents/researcher.md`
- Grounding docs: `TESTING.md`, `AGENTS.md`, `.claude/skills/pr-self-review/references/skill-scope-map.md`, `.claude/skills/mermaid-diagram`
- Open-question evidence: `server/package.json:25` (`dependency-cruiser` present but unwired)
