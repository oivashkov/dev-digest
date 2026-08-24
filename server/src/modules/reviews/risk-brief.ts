import type { PrRiskBrief, Risk, RiskSeverity } from '@devdigest/shared';
import {
  extractRiskBrief,
  groundRiskBrief,
  riskBriefGroundingSummary,
  type RiskBriefTicketInput,
  type RiskBriefPlanExcerptInput,
} from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { RunLogger } from '../../platform/run-logger.js';
import type * as schema from '../../db/schema.js';
import type { PullRow } from '../../db/rows.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { getOrComputeIntent, isSafePlanRefPath, type IntentLog } from './intent.js';
import { buildPrBlastRadius } from './blast.js';
import type { PrBlastRadius } from '@devdigest/shared';

/**
 * PR Why + Risk Brief — `getOrComputeRiskBrief`, structurally a sibling of
 * `getOrComputeIntent` (`./intent.js`), whose cache-read → in-flight-dedup →
 * compute shape (AC1-4) is mirrored exactly (`intent.ts:348-377`). Behind
 * `GET /pulls/:id/brief` (compute-if-missing) and `POST
 * /pulls/:id/brief/refresh` (forced), both wired in Step 5's `service.ts`.
 *
 * Imports from `intent.ts` READ-ONLY (`getOrComputeIntent`,
 * `isSafePlanRefPath`, the `IntentLog` type) and never modifies it — `./blast.js`'s
 * `buildPrBlastRadius` plus `container.repoIntel.getBlastRadius`/
 * `getIndexState` are called directly here (the same call shape
 * `service.ts`'s `getBlastRadius` already uses), so this module does not
 * depend on `ReviewService` either. Diff-stat assembly and plan/spec-excerpt
 * re-reading are each a deliberate LOCAL copy of the equivalent logic in
 * `intent.ts` — that logic isn't exported there, and keeping this module
 * self-contained keeps the two features' Owned paths disjoint (per the
 * plan's §6).
 *
 * Never throws — any failure (LLM error, timeout, schema failure) degrades
 * to `undefined` and leaves any prior cached brief untouched (AC18), the
 * exact same degrade-to-`undefined` contract `computeIntent` already uses.
 */

type RepoRow = typeof schema.repos.$inferSelect;

/** How many changed-file lines to include in the diff-stat block — starts at
 *  `MAX_DIFF_STAT_FILES`'s value (`intent.ts:39`) for consistency; tune
 *  independently if a real large-PR run shows the model needs more. Local
 *  copy, not exported from `intent.ts` — see the module doc-comment. */
const MAX_RISK_BRIEF_DIFF_STAT_FILES = 20;

/** How many blast-radius symbols to list in the prompt's blast-summary
 *  section — bounds prompt size the same way the diff-stat cap does; the
 *  grounding allowlist itself (`impacted_endpoints`/`impacted_crons`) is
 *  never truncated, only what's shown in-prompt is. */
const MAX_RISK_BRIEF_BLAST_SYMBOLS = 20;

/** Per-file truncation for a re-read plan/spec excerpt — matches
 *  `MAX_PLAN_EXCERPT_CHARS` (`intent.ts:36`). */
const MAX_RISK_BRIEF_PLAN_EXCERPT_CHARS = 20_000;

/**
 * Bounded timeout for the structured risk-brief call. Longer than intent's
 * `INTENT_CLASSIFY_TIMEOUT_MS` (20s) since `risk_brief` defaults to a
 * stronger, non-cheap model (`openai/gpt-4.1`) over a larger prompt — a
 * proposal from the spec (Non-functional requirements), not a measurement;
 * tune if real large-PR runs show it too short or too long.
 */
const RISK_BRIEF_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Logging — same dual shape (`RunLogger` | Fastify-style logger) as
// `intent.ts`'s `IntentLog`. `logInfo`/`logWarn` are NOT exported from
// `intent.ts`, so they're re-declared locally (identical behavior) rather
// than editing that file — per the plan's §8 cross-cutting note, `intent.ts`
// is read-only for every step of this plan.
// ---------------------------------------------------------------------------

function isRunLogger(log: IntentLog): log is RunLogger {
  return typeof (log as RunLogger).step === 'function';
}

function logInfo(log: IntentLog, msg: string, data?: unknown): void {
  if (isRunLogger(log)) log.info(msg, data);
  else log.info(data, msg);
}

function logWarn(log: IntentLog, msg: string, data?: unknown): void {
  // RunLogger has no `.warn` — match intent.ts's convention of degrading to
  // `.info` for RunLogger callers (non-fatal — never marks the Live Log red).
  if (isRunLogger(log)) log.info(msg, data);
  else log.warn(data, msg);
}

// ---------------------------------------------------------------------------
// Deterministic risk_level (never a model self-report) — same principle as
// `tierFor()` (`intent.ts:102-115`) and `groundFindings()`'s own downstream
// score computation. AC14-16.
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<RiskSeverity, number> = { low: 0, medium: 1, high: 2 };

/** Max severity across `risks` (post-grounding); `'low'` when empty (AC16). */
export function riskLevelFor(risks: Risk[]): RiskSeverity {
  let max: RiskSeverity = 'low';
  for (const r of risks) {
    if (SEVERITY_RANK[r.severity] > SEVERITY_RANK[max]) max = r.severity;
  }
  return max;
}

// ---------------------------------------------------------------------------
// Diff-stat block — file-list-only (path + adds/dels), NEVER a hunk body
// (AC6). Deliberate local copy of `buildDiffStatFallback`'s shape
// (`intent.ts:325-336`); unlike intent's version (a low-confidence LAST
// RESORT, only built when no other signal exists), diff stats here are a
// PRIMARY input assembled on every compute (AC5) — so this takes the
// already-fetched file list directly rather than re-querying it, and is not
// gated behind a "no other signal" check.
// ---------------------------------------------------------------------------

function buildDiffStat(
  files: { path: string; additions: number; deletions: number }[],
  pull: PullRow,
): string | undefined {
  if (pull.filesCount === 0 && pull.additions === 0 && pull.deletions === 0) return undefined;
  const header = `${pull.filesCount} file(s) changed (+${pull.additions}/-${pull.deletions})`;
  if (files.length === 0) return header;
  const lines = files
    .slice(0, MAX_RISK_BRIEF_DIFF_STAT_FILES)
    .map((f) => `- ${f.path} (+${f.additions}/-${f.deletions})`);
  return `${header}\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Blast-radius summary block — text form of the already-computed
// `PrBlastRadius` (never re-derives it; `./blast.js`'s pure mapper does
// that). Capped at `MAX_RISK_BRIEF_BLAST_SYMBOLS` for prompt-size reasons
// only — the grounding allowlist below is built from the UNCAPPED
// `impacted_endpoints`/`impacted_crons`, matching AC12's "not just the
// truncated in-prompt subset" requirement (the same shape the diff-stat
// allowlist already follows for files, per the plan's "Grounding" bullet).
// ---------------------------------------------------------------------------

function buildBlastSummary(blast: PrBlastRadius): string | undefined {
  if (
    blast.symbols.length === 0 &&
    blast.impacted_endpoints.length === 0 &&
    blast.impacted_crons.length === 0
  ) {
    return undefined;
  }
  const lines: string[] = [`status: ${blast.status}${blast.reason ? ` (${blast.reason})` : ''}`];
  for (const sym of blast.symbols.slice(0, MAX_RISK_BRIEF_BLAST_SYMBOLS)) {
    const callerCount = sym.callers_truncated ? `${sym.callers.length}+` : `${sym.callers.length}`;
    lines.push(`- ${sym.name} (${sym.file}): ${callerCount} caller(s)`);
  }
  if (blast.impacted_endpoints.length > 0) lines.push(`Endpoints: ${blast.impacted_endpoints.join(', ')}`);
  if (blast.impacted_crons.length > 0) lines.push(`Crons: ${blast.impacted_crons.join(', ')}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Linked ticket — live fetch, same shape as `intent.ts`'s private
// `fetchTicket` (`linked_issue` is not persisted on `PullRow`, and `Intent`
// doesn't carry the ticket text through either, so this re-fetches rather
// than reusing anything cached).
// ---------------------------------------------------------------------------

async function fetchTicket(
  container: Container,
  repo: RepoRow,
  prNumber: number,
): Promise<RiskBriefTicketInput | undefined> {
  try {
    const vcs = await container.vcsFor(repo);
    const detail = await vcs.getPullRequest(repo, prNumber);
    const linked = detail.linked_issue;
    if (!linked) return undefined;
    return { title: linked.title, body: linked.body ?? undefined };
  } catch {
    // VCS unavailable / offline / no token — degrade to no ticket signal.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Plan/spec excerpts — re-extracted from `Intent.plan_refs` (paths only, no
// cached content) and re-guarded with `isSafePlanRefPath` before EVERY read,
// exactly as `resolvePlanRefs` does in intent.ts and as the spec's "Plan/spec
// excerpt re-read" edge case requires — trusting the path list alone,
// without re-guarding the read, would reopen the path-traversal risk Intent
// Layer already closed.
// ---------------------------------------------------------------------------

async function resolvePlanExcerpts(
  container: Container,
  repo: RepoRow,
  planRefs: string[],
  log: IntentLog,
): Promise<RiskBriefPlanExcerptInput[]> {
  if (planRefs.length === 0) return [];
  const clonePath = container.git.clonePathFor(repo);
  const excerpts: RiskBriefPlanExcerptInput[] = [];
  let rejected = 0;
  for (const path of planRefs) {
    if (!isSafePlanRefPath(clonePath, path)) {
      rejected += 1;
      continue;
    }
    try {
      const content = await container.git.readFile(repo, path);
      excerpts.push({ path, content: content.slice(0, MAX_RISK_BRIEF_PLAN_EXCERPT_CHARS) });
    } catch {
      // File doesn't exist at this ref / repo not cloned yet — skip silently,
      // same convention as `resolvePlanRefs` (intent.ts:282-285).
    }
  }
  if (rejected > 0) {
    // No `prId` in scope here (this helper only receives `repo`) — matches
    // `resolvePlanRefs`'s own convention of omitting the data arg
    // (`intent.ts:287-292`) rather than mislabeling `repo.id` as a PR id.
    logInfo(log, `PR risk brief: plan/spec refs — ${rejected} rejected by path guard`);
  }
  return excerpts;
}

// ---------------------------------------------------------------------------
// getOrComputeRiskBrief — the shared entry point.
// ---------------------------------------------------------------------------

/** In-flight de-dup, keyed by PR id — checked regardless of `force`, mirroring
 *  `intent.ts`'s `inflight` map (`intent.ts:346,369-376`) exactly. */
const inflight = new Map<string, Promise<PrRiskBrief | undefined>>();

export async function getOrComputeRiskBrief(
  container: Container,
  workspaceId: string,
  repo: RepoRow,
  pull: PullRow,
  opts: { force: boolean },
  log: IntentLog,
): Promise<PrRiskBrief | undefined> {
  if (!opts.force) {
    try {
      const cached = await container.reviewRepo.getPrBrief(pull.id);
      if (cached) {
        logInfo(log, `PR risk brief: reusing cached result (risk_level=${cached.risk_level})`, { prId: pull.id });
        return cached;
      }
    } catch (err) {
      // A broken cache read shouldn't block a fresh compute below.
      logWarn(log, `PR risk brief: cache read failed — computing fresh (${(err as Error).message})`, {
        prId: pull.id,
      });
    }
  }

  const existing = inflight.get(pull.id);
  if (existing) return existing;

  const promise = computeRiskBrief(container, workspaceId, repo, pull, log).finally(() => {
    inflight.delete(pull.id);
  });
  inflight.set(pull.id, promise);
  return promise;
}

async function computeRiskBrief(
  container: Container,
  workspaceId: string,
  repo: RepoRow,
  pull: PullRow,
  log: IntentLog,
): Promise<PrRiskBrief | undefined> {
  const start = Date.now();
  logInfo(log, `PR risk brief: computing for PR #${pull.number}`, { prId: pull.id });

  try {
    // Intent first (AC7-8): non-forced compute-if-missing; a degrade to
    // `undefined` proceeds without an intent section rather than failing.
    const intent = await getOrComputeIntent(container, workspaceId, repo, pull, { force: false }, log);

    const files = await container.reviewRepo.getPrFiles(pull.id);
    const allowlistFiles = new Set(files.map((f) => f.path));

    const [blastResult, indexState] = await Promise.all([
      container.repoIntel.getBlastRadius(pull.repoId, [...allowlistFiles]),
      container.repoIntel.getIndexState(pull.repoId),
    ]);
    const blast = buildPrBlastRadius({ prId: pull.id, repoId: pull.repoId, result: blastResult, indexState });
    // Grounding allowlist uses the UNCAPPED endpoint/cron sets — never just
    // the truncated in-prompt blast summary (AC12, spec's "very large PR"
    // edge case).
    const allowlistEndpoints = new Set([...blast.impacted_endpoints, ...blast.impacted_crons]);

    const diffStat = buildDiffStat(files, pull);
    const blastSummary = buildBlastSummary(blast);

    const description = pull.body?.trim() || undefined;
    const ticket = await fetchTicket(container, repo, pull.number);
    const planExcerpts = await resolvePlanExcerpts(container, repo, intent?.plan_refs ?? [], log);

    logInfo(
      log,
      `PR risk brief: signals — intent=${!!intent} description=${!!description} ticket=${!!ticket} ` +
        `blast=${!!blastSummary} planRefs=${planExcerpts.length}`,
      { prId: pull.id },
    );

    const { provider, model } = await resolveFeatureModel(container, workspaceId, 'risk_brief');
    const llm = await container.llm(provider);
    logInfo(log, `PR risk brief: model resolved — ${provider}/${model}`, { prId: pull.id });

    const outcome = await extractRiskBrief({
      llm,
      model,
      title: pull.title,
      ...(description ? { description } : {}),
      ...(intent?.intent ? { intent: intent.intent } : {}),
      ...(blastSummary ? { blastSummary } : {}),
      ...(diffStat ? { diffStat } : {}),
      ...(ticket ? { ticket } : {}),
      ...(planExcerpts.length > 0 ? { planExcerpts } : {}),
      sessionId: `${repo.owner}/${repo.name}#${pull.number}:risk-brief`,
      timeoutMs: RISK_BRIEF_TIMEOUT_MS,
    });

    const grounded = groundRiskBrief(outcome.extraction, {
      files: allowlistFiles,
      endpoints: allowlistEndpoints,
    });
    logInfo(log, `PR risk brief: grounding — ${riskBriefGroundingSummary(grounded)}`, { prId: pull.id });

    const risk_level = riskLevelFor(grounded.risks);

    const brief: PrRiskBrief = {
      what: outcome.extraction.what,
      why: outcome.extraction.why,
      risks: grounded.risks,
      review_focus: grounded.review_focus,
      pr_id: pull.id,
      risk_level,
      head_sha: pull.headSha,
    };

    await container.reviewRepo.upsertPrBrief(pull.id, brief);

    logInfo(
      log,
      `PR risk brief: computed — risk_level=${risk_level} (${Date.now() - start}ms, cost=${outcome.costUsd ?? 'n/a'})`,
      { prId: pull.id, tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut },
    );

    return brief;
  } catch (err) {
    // Never persist a partial result — leave any prior cached brief
    // untouched, matching `computeIntent`'s degrade-to-`undefined` contract
    // (intent.ts:448-455). AC18.
    logWarn(log, `PR risk brief: compute failed — leaving cache untouched (${(err as Error).message})`, {
      prId: pull.id,
    });
    return undefined;
  }
}
