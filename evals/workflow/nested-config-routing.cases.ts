import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — nested CLAUDE.md scenario. Root CLAUDE.md/AGENTS.md is not the
 * whole story: `client/`, `server/`, `reviewer-core/`, and `e2e/` each carry their own
 * `CLAUDE.md` (a bare `@AGENTS.md` include) with package-specific conventions the root file
 * never repeats (npm-vs-pnpm per package, the Zod-validation convention, the hooks-only rule).
 * `review-workflow.cases.ts` only ever asserts on root-level routing — nothing there proves a
 * session actually picks up a NESTED file when the task is scoped to that package. This file is
 * that proof, plus one deliberate negative control (`mcp-server/` has no nested file at all) and
 * one root-vs-per-package `INSIGHTS.md` pair.
 *
 * Budget: 6 Claude sessions, all `trace` (1 session each, stops once its expectation is met).
 *
 * `expectFilesRead` matches by substring (`actualPath.includes(target)`), so a bare filename
 * ("INSIGHTS.md") would match EVERY package's copy — not just the one you meant. The
 * root-vs-per-package pair below relies on this: `"server/INSIGHTS.md"` only appears in the
 * server one (no other real path contains that exact substring), while the root case matches on
 * `"dev-digest/INSIGHTS.md"` (the repo folder name immediately followed by the filename, with no
 * intervening package segment) — the shortest substring that's still unique to the root file. If
 * this repo is ever cloned under a different folder name, that one target needs updating.
 */
export const cases: WorkflowCase[] = [
  // --- server/, package-manager gotcha: reviewer-core is npm, not pnpm, and only its own -------
  // AGENTS.md says so — the root file only states the rule in the abstract ("never run the wrong
  // package manager"), without naming which packages use which. A session that never opens
  // reviewer-core/AGENTS.md has no documented source for the right command.
  {
    kind: "trace",
    name: "reviewer-core test-run task reads reviewer-core/AGENTS.md for the npm-vs-pnpm gotcha",
    prompt:
      "Хочу запустити тести в reviewer-core. Перш ніж щось запускати, звірся з package-manager " +
      "конвенціями САМЕ цього пакета (в цьому репо не всі пакети на pnpm) і прочитай той документ.",
    expectFilesRead: ["reviewer-core/AGENTS.md"],
    maxTurns: 6,
  },

  // --- server/, Zod/DI convention only documented in the nested file ----------------------------
  {
    kind: "trace",
    name: "server route task reads server/AGENTS.md, not just root",
    prompt:
      "Я збираюся додати новий route в server. Перш ніж писати код, звірся з package-специфічними " +
      "(не кореневими) конвенціями server-пакета щодо валідації вхідних даних і прочитай той документ.",
    expectFilesRead: ["server/AGENTS.md"],
    maxTurns: 6,
  },

  // --- client/, hooks-only convention only documented in the nested file ------------------------
  {
    kind: "trace",
    name: "client component task reads client/AGENTS.md, not just root",
    prompt:
      "Я хочу додати компонент, який дістає список review з бекенду. Перш ніж писати код, звірся з " +
      "package-специфічними (не кореневими) конвенціями client-пакета щодо доступу до даних і " +
      "прочитай той документ.",
    expectFilesRead: ["client/AGENTS.md"],
    maxTurns: 6,
  },

  // --- mcp-server/, negative control: no nested CLAUDE.md/AGENTS.md exists here at all -----------
  // Confirmed by `ls .claude/... `/`ls mcp-server`: only README.md + INSIGHTS.md, no CLAUDE.md.
  // The root "Read when" table's mcp-server row must still fire WITHOUT a nested file to lean on —
  // this is the control showing the root table works independently of the nested-file layer.
  {
    kind: "trace",
    name: "mcp-server task follows the root Read-When routing with no nested CLAUDE.md to help it",
    prompt:
      "Хочу додати новий MCP tool у mcp-server. Спершу звірся з документацією цього репо про те, " +
      "як це робити правильно, і прочитай відповідний файл.",
    expectFilesRead: ["mcp-server/README.md"],
    maxTurns: 6,
  },

  // --- root vs. per-package INSIGHTS.md: which one applies depends on the task's blast radius ----
  {
    kind: "trace",
    name: "single-package question reads the PACKAGE's own INSIGHTS.md",
    prompt:
      "Чому індексація repo-intel в server працює повільно? Перш ніж копатись у коді, перевір, чи " +
      "це вже колись досліджували в цьому пакеті, і прочитай відповідний файл.",
    expectFilesRead: ["server/INSIGHTS.md"],
    maxTurns: 6,
  },
  {
    kind: "trace",
    name: "cross-package question reads the ROOT INSIGHTS.md",
    prompt:
      "Я збираюсь змінити Zod-контракт у @devdigest/shared — це вплине на кілька пакетів одразу. " +
      "Перш ніж чіпати код, перевір, чи подібні рішення, що зачіпають більш ніж один пакет, вже " +
      "задокументовані на рівні всього репо, і прочитай відповідний файл.",
    expectFilesRead: ["dev-digest/INSIGHTS.md"],
    maxTurns: 6,
  },
];
