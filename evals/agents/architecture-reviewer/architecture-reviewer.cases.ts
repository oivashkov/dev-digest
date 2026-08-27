import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

const REVIEW_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("checkout-service.diff")}`;

// A second real diff whose violations map onto DevDigest-SPECIFIC rule names
// (`reviewer-core-zero-io`, `reviewer-core-ground-findings-gate`) that a competent model will
// describe in prose but will not spontaneously name unless the agent forces a citation. This is
// the discriminating case for the strict-vs-lite A/B: both variants should FIND both problems,
// but only the strict variant (which keeps the "cite the exact documented rule per finding" hard
// rule) should reliably emit the identifier. The checkout diff's textbook violations don't
// discriminate — the model volunteers `inward-only-dependencies`/`di-discipline` either way.
const REVIEWER_CORE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("reviewer-core-gate.diff")}`;

// A diff that violates NO documented rule (a pure local-variable rename inside a domain file, no
// new imports, no cross-layer edges). A grounded reviewer should report zero violations. This
// surfaces the COST of relaxing the citation rule: freed from "every finding must name a
// documented contract", the lite variant is more prone to fabricating a judgment/best-practice
// finding where the strict variant stays silent.
const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("benign-refactor.diff")}`;

// Client-side skip-call: a component calling fetch() directly instead of going through a hook.
// Fully diff-local (both the violating line and its context sit in the one hunk) — no repo-wide
// search needed to catch it, so this is NOT expected to discriminate strict vs lite; both variants
// should flag it identically, just without (lite) / with (strict) the `hooks-only-data-access` slug.
const CLIENT_FETCH_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("client-fetch-violation.diff")}`;

// A two-file import cycle where BOTH sides of the cycle are visible in the diff itself: the new
// `+import type { RepricingPolicy } from "./service.js"` line in repository.ts, and service.ts's
// own (unchanged, pre-existing) `import { PgPricingRepository } from "./repository.js"` context
// line. Since both edges are readable straight off the diff text, this does NOT need the
// repo-wide trace lite is scoped out of — NOT expected to discriminate strict vs lite.
const CYCLIC_IMPORT_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("cyclic-import.diff")}`;

// A NEW ad-hoc VCS resolver (`resolveVcsClient`) that duplicates the REAL, already-existing
// `container.vcsFor(repo)` pattern (genuine call sites at server/src/modules/pulls/service.ts and
// server/src/modules/polling/routes.ts — grep-able in this actual repo, unlike the fictional
// module the diff itself lives in). This is the one fixture where "go verify this is really a
// duplicate, not just a lookalike" costs a real repo-wide Grep — exactly what architecture-reviewer-lite's
// scope note says it is not required to spend. Expected to (softly) discriminate: strict is more
// likely to cite a real existing call site as corroborating evidence; lite may defer that specific
// evidence to "Could not confirm" instead, per its own scope note.
const DUPLICATE_FUNCTIONALITY_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("duplicate-functionality.diff")}`;

// A NEW (not the already-known settings/routes.ts:96) direct container.github() call — Warning
// per the severity guide's own example, no Critical finding anywhere in the diff. Tests the gate
// verdict logic added to §6/§4 specifically: one non-blocking finding must still gate PASS. NOT
// expected to discriminate strict vs lite — the gate rule itself is identical in both variants.
const MIXED_SEVERITY_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("mixed-severity-gate.diff")}`;

// No diff at all — the exact ambiguous phrasing §0 itself uses as an example ("review the
// server"). The ONLY case in this file designed to diverge on purpose: strict's §0 says ask
// before starting; architecture-reviewer-lite has §0 removed and is told to proceed with a stated
// assumption instead. One shared practice, so the split shows up directly in `eval:delta` — expect
// strict to PASS it and lite to FAIL it, by design, not as a bug in either agent.
const AMBIGUOUS_TARGET_PROMPT = `Review the server for architectural boundary violations.`;

// Shared across the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite)
// variants so the two agents are graded on the exact same task — the only thing that should
// move between the two runs is whether "cites the specific documented rule" keeps passing.
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "flags the domain file (checkout.ts) importing a type from 'fastify' as a violation of the inward-only dependency rule between Domain and Presentation layers",
      "flags the `new PgCheckoutRepository()` call inside service.ts as a violation of DI discipline (concrete adapters/repositories must be constructed only in the composition root / container)",
      "names the specific documented rule identifier for EVERY finding (e.g. `inward-only-dependencies`, `di-discipline`) rather than describing the problem only in prose",
      "assigns a severity (critical/high/medium/low/info) to each finding",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate an architecture finding for the out-of-scope security-shaped change",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "does not invent an architecture-contract violation for the optional `reply?: FastifyReply` parameter beyond the inward-only-dependencies import issue itself (no runtime bug/security finding fabricated as an architecture rule)",
      "stays scoped to structural/layering/DI findings and does not comment on naming, style, or test coverage",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "cites the DevDigest-specific rule identifier for reviewer-core violations",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/pipeline/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that runPipeline now returns `deduped` directly, skipping the mandatory `groundFindings()` gate before emitting findings",
      "names the exact documented rule identifier `reviewer-core-zero-io` for the fs-import finding rather than only describing it in prose",
      "names the exact documented rule identifier `reviewer-core-ground-findings-gate` for the skipped-gate finding rather than only describing it in prose",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no violations for the benign rename (or records only `info`-level, non-blocking observations) — it does not invent a critical/high/medium finding",
      "does not fabricate a documented-rule violation where the diff violates none of the checked rules",
      "the final gate verdict is PASS",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "flags a direct client fetch() call as a hooks-only-data-access violation",
    kind: "quality",
    prompt: CLIENT_FETCH_PROMPT,
    practices: [
      "flags the `fetch(` call inside ReviewList.tsx's useEffect as a violation of the hooks-only data access rule (all data access must go through a hook in src/lib/hooks/* calling src/lib/api.ts)",
      "classifies the finding as Warning, not Critical, matching the severity guide's own example (a new fetch() call in a client component instead of a hook)",
      "quotes the offending `fetch(` line verbatim as evidence",
      "the final gate verdict is PASS (no Critical finding was reported)",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "flags the two-file cyclic dependency between pricing/repository.ts and pricing/service.ts",
    kind: "quality",
    prompt: CYCLIC_IMPORT_PROMPT,
    practices: [
      "flags a Cyclic dependency between server/src/modules/pricing/repository.ts (new `import type { RepricingPolicy } from \"./service.js\"`) and server/src/modules/pricing/service.ts (which already imports PgPricingRepository from ./repository.js)",
      "names both file:line locations that together form the cycle, not just one side of it",
      "quotes the offending import line from repository.ts verbatim as evidence",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "flags the new ad-hoc VCS resolver as duplicate functionality beside container.vcsFor",
    kind: "quality",
    prompt: DUPLICATE_FUNCTIONALITY_PROMPT,
    practices: [
      "flags `resolveVcsClient` in the new vcs-lookup.ts file as duplicate functionality alongside the repo's existing container.vcsFor(repo) resolver",
      "names at least one real existing call site of container.vcsFor (e.g. server/src/modules/pulls/service.ts or server/src/modules/polling/routes.ts) as evidence this duplicates an existing pattern rather than asserting the duplication only hypothetically",
      "classifies the finding as Suggestion severity, matching the severity guide (duplicate functionality is Suggestion-level, not Critical)",
      "the final gate verdict is PASS",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "gate verdict is PASS on a Warning-only finding, not just on zero findings",
    kind: "quality",
    prompt: MIXED_SEVERITY_PROMPT,
    practices: [
      "flags the new `container.github()` call in refund-routes.ts as a violation of the vcs-resolution-boundary rule (VCS access must go through container.vcsFor(repo))",
      "classifies the finding as Warning, not Critical, matching the severity guide's own example (a new direct container.github() call instead of vcsFor)",
      "the final gate verdict is PASS despite the reported Warning finding",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    // The one intentionally discriminating case in this file (see the prompt's comment above) —
    // do not be surprised if this case is red for architecture-reviewer-lite; that is the point.
    name: "asks for scope clarification on an ambiguous, diff-less target",
    kind: "quality",
    prompt: AMBIGUOUS_TARGET_PROMPT,
    practices: [
      "asks a clarifying question about what to audit (a specific diff/module vs. the whole server/ module) BEFORE producing any findings, rather than proceeding straight to a full audit",
    ],
    threshold: 1.0,
    maxTurns: 10,
  },
];
