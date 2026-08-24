import type { PrRiskBrief, Risk, RiskSeverity } from '@devdigest/shared';
import {
  extractRiskBrief,
  groundRiskBrief,
  riskBriefGroundingSummary,
  buildRiskBriefMessages,
  type RiskBriefTicketInput,
  type RiskBriefPlanExcerptInput,
  type RiskBriefPromptInput,
} from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { RunLogger } from '../../platform/run-logger.js';
import type * as schema from '../../db/schema.js';
import type { PullRow } from '../../db/rows.js';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
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

/**
 * Whole-assembled-prompt token budget (SPEC-03 amendment, AC26/OQ8) — a
 * decided number, not a measurement (OQ8's resolution: 8,000 tokens,
 * counted by `Tokenizer.count()`, no new counting logic). The per-section
 * caps above (`MAX_RISK_BRIEF_*`) bound each input independently but never
 * bounded the *assembled* prompt, so a PR under every per-section cap could
 * still exceed a real model's context window. Measured as
 * `tokenizer.count(system) + tokenizer.count(user)` over
 * `buildRiskBriefMessages`'s output — the sum of the two per-message counts
 * (AC25's confirmed reading of "combined token count"), never a
 * concatenation of the two strings.
 */
const RISK_BRIEF_PROMPT_TOKEN_BUDGET = 8_000;

/** Fixed ladder of shrinking per-excerpt truncation lengths tried on the
 *  single surviving plan/spec excerpt before it is dropped entirely
 *  (AC31, the confirmed "reduce truncation length" step between "drop from
 *  the end" and "drop it entirely"). Starts below
 *  `MAX_RISK_BRIEF_PLAN_EXCERPT_CHARS`. */
const RISK_BRIEF_EXCERPT_CHAR_LADDER = [10_000, 5_000, 2_000, 1_000, 500];

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

/**
 * Diff-stat block, generalized with an optional row cap + sort mode so the
 * fitter (`fitRiskBriefPromptToBudget` below) can re-render smaller
 * candidates without duplicating this logic. Callers outside the fitter
 * (the "signals" log line) use the defaults, which reproduce the pre-budget
 * behavior byte-for-byte: cap at `MAX_RISK_BRIEF_DIFF_STAT_FILES`, original
 * (unsorted) row order.
 *
 * `sortByChurn` is only ever `true` while the fitter is actively trimming
 * (AC32) — retains the largest `additions + deletions`, stable tiebreak on
 * `path` when churn is equal so the same PR doesn't produce two different
 * prompts across runs. Floor is the header line alone, never nothing.
 */
function buildDiffStat(
  files: { path: string; additions: number; deletions: number }[],
  pull: Pick<PullRow, 'filesCount' | 'additions' | 'deletions'>,
  maxFiles: number = MAX_RISK_BRIEF_DIFF_STAT_FILES,
  sortByChurn = false,
): string | undefined {
  if (pull.filesCount === 0 && pull.additions === 0 && pull.deletions === 0) return undefined;
  const header = `${pull.filesCount} file(s) changed (+${pull.additions}/-${pull.deletions})`;
  if (files.length === 0) return header;
  const ordered = sortByChurn
    ? [...files].sort((a, b) => {
        const churn = b.additions + b.deletions - (a.additions + a.deletions);
        return churn !== 0 ? churn : a.path.localeCompare(b.path);
      })
    : files;
  const lines = ordered
    .slice(0, Math.max(0, maxFiles))
    .map((f) => `- ${f.path} (+${f.additions}/-${f.deletions})`);
  if (lines.length === 0) return header;
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

/**
 * Blast-radius summary block, generalized with an optional symbol cap so
 * the fitter can re-render smaller candidates (AC28-30). The `status:` line
 * and the `Endpoints:`/`Crons:` lines are NEVER capped — those are what
 * `review_focus.endpoint` citations are grounded against (AC30's "keeping
 * the status:/Endpoints:/Crons: lines" requirement) — only the per-symbol
 * caller list shrinks.
 */
function buildBlastSummary(
  blast: PrBlastRadius,
  maxSymbols: number = MAX_RISK_BRIEF_BLAST_SYMBOLS,
): string | undefined {
  if (
    blast.symbols.length === 0 &&
    blast.impacted_endpoints.length === 0 &&
    blast.impacted_crons.length === 0
  ) {
    return undefined;
  }
  const lines: string[] = [`status: ${blast.status}${blast.reason ? ` (${blast.reason})` : ''}`];
  for (const sym of blast.symbols.slice(0, Math.max(0, maxSymbols))) {
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
// fitRiskBriefPromptToBudget — the whole-prompt token-budget fitter
// (SPEC-03 amendment, AC25-35). Mirrors `renderRepoMap`'s proven signature
// shape (`modules/repo-intel/pipeline/repo-map.ts:28-57`): a plain, pure,
// exported function taking `Tokenizer` as a parameter — never reaching into
// `container.tokenizer` itself — so every case here is a plain unit test
// with no `Container` cast at all.
// ---------------------------------------------------------------------------

/** The raw, not-yet-rendered signals the fitter needs so it can re-render
 *  the diff-stat / blast-summary blocks at smaller sizes — the already-
 *  rendered `RiskBriefPromptInput` alone isn't enough for that (AC28-32
 *  require trimming by structure, not by re-truncating rendered text). */
export interface RiskBriefFitSections {
  title: string;
  description?: string;
  intent?: string;
  files: { path: string; additions: number; deletions: number }[];
  pull: Pick<PullRow, 'filesCount' | 'additions' | 'deletions'>;
  blast?: PrBlastRadius;
  ticket?: RiskBriefTicketInput;
  planExcerpts: RiskBriefPlanExcerptInput[];
}

export interface RiskBriefFitSectionReport {
  planExcerpts: { kept: number; total: number };
  diffStatFiles: { kept: number; total: number };
  blastSymbols: { kept: number; total: number };
  ticketBodyDropped: boolean;
}

export interface RiskBriefFitResult {
  /** The final, possibly-trimmed content — feed straight into
   *  `extractRiskBrief` alongside `llm`/`model`/etc. */
  input: RiskBriefPromptInput;
  /** `false` when the untrimmed assembly already fit (AC27) — no trimming
   *  was applied and `input` is byte-identical to the untrimmed render. */
  trimmed: boolean;
  /** Token count of the untrimmed candidate, before any trimming. */
  tokensBefore: number;
  /** Token count of `input` — the final candidate actually returned. */
  tokens: number;
  budget: number;
  report: RiskBriefFitSectionReport;
}

/**
 * Fit the assembled risk-brief prompt under `budget` tokens by prioritized,
 * re-measured trimming (AC28-30). Never trims `title`/`description` (AC33)
 * — those are structural fields on `RiskBriefFitSections`, not part of any
 * trim step below. The injection-defense note and the output-schema
 * instructions are ALSO never trimmed, but that guarantee is structural for
 * a different reason: they live inside `reviewer-core`'s `SYSTEM_PROMPT` /
 * `RISK_BRIEF_INJECTION_NOTE` and are never inputs to this function at all.
 *
 * Ladder, in order, each step re-measuring and stopping the instant the
 * count is `<= budget` (AC28):
 *   1. Plan/spec excerpts — drop from the end one at a time until one
 *      remains (AC31); then shrink that survivor's truncation length via
 *      `RISK_BRIEF_EXCERPT_CHAR_LADDER`; then drop it entirely.
 *   2. Diff-stat file rows — re-rendered below `MAX_RISK_BRIEF_DIFF_STAT_FILES`,
 *      retaining the largest `additions + deletions` with a stable path
 *      tiebreak (AC32). Floor is the header line alone, never nothing.
 *   3. Blast-radius symbols — re-rendered below
 *      `MAX_RISK_BRIEF_BLAST_SYMBOLS`, keeping the `status:`/`Endpoints:`/
 *      `Crons:` lines.
 *   4. Linked-ticket body — dropped; `ticket.title` is never trimmed (AC28).
 *
 * Does NOT throw when the floor is still over budget — returns the
 * fully-trimmed candidate with `tokens > budget` and lets the caller
 * (`computeRiskBrief`) decide what "still too big" means (AC34).
 */
export function fitRiskBriefPromptToBudget(
  sections: RiskBriefFitSections,
  tokenizer: Tokenizer,
  budget: number,
): RiskBriefFitResult {
  const totalExcerpts = sections.planExcerpts.length;
  const totalFiles = sections.files.length;
  const totalSymbols = sections.blast?.symbols.length ?? 0;
  const diffRowsTotal = Math.min(totalFiles, MAX_RISK_BRIEF_DIFF_STAT_FILES);
  const blastSymbolsTotal = Math.min(totalSymbols, MAX_RISK_BRIEF_BLAST_SYMBOLS);

  let excerpts = sections.planExcerpts;
  let diffFileLimit = MAX_RISK_BRIEF_DIFF_STAT_FILES;
  let sortDiffByChurn = false;
  let symbolLimit = MAX_RISK_BRIEF_BLAST_SYMBOLS;
  let ticket = sections.ticket;
  let ticketBodyDropped = false;

  const build = (): RiskBriefPromptInput => {
    const diffStat = buildDiffStat(sections.files, sections.pull, diffFileLimit, sortDiffByChurn);
    const blastSummary = sections.blast ? buildBlastSummary(sections.blast, symbolLimit) : undefined;
    return {
      title: sections.title,
      ...(sections.description ? { description: sections.description } : {}),
      ...(sections.intent ? { intent: sections.intent } : {}),
      ...(blastSummary ? { blastSummary } : {}),
      ...(diffStat ? { diffStat } : {}),
      ...(ticket ? { ticket } : {}),
      ...(excerpts.length > 0 ? { planExcerpts: excerpts } : {}),
    };
  };

  const measure = (input: RiskBriefPromptInput): number => {
    const messages = buildRiskBriefMessages(input);
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    // AC25's confirmed reading: sum of the two per-message counts, never a
    // concatenation of the two strings.
    return tokenizer.count(system) + tokenizer.count(user);
  };

  const reportFor = (): RiskBriefFitSectionReport => ({
    planExcerpts: { kept: excerpts.length, total: totalExcerpts },
    diffStatFiles: { kept: Math.min(diffFileLimit, diffRowsTotal), total: diffRowsTotal },
    blastSymbols: { kept: Math.min(symbolLimit, blastSymbolsTotal), total: blastSymbolsTotal },
    ticketBodyDropped,
  });

  let input = build();
  const tokensBefore = measure(input);
  let tokens = tokensBefore;

  if (tokens <= budget) {
    return { input, trimmed: false, tokensBefore, tokens, budget, report: reportFor() };
  }

  // 1a. Drop plan/spec excerpts from the end, one at a time, until one remains.
  while (excerpts.length > 1 && tokens > budget) {
    excerpts = excerpts.slice(0, -1);
    input = build();
    tokens = measure(input);
  }

  // 1b. Shrink the survivor's truncation length — always slices from the
  // original (already 20,000-char-capped) content, never cumulatively.
  const survivor = excerpts[0];
  if (survivor && excerpts.length === 1 && tokens > budget) {
    for (const limit of RISK_BRIEF_EXCERPT_CHAR_LADDER) {
      if (tokens <= budget) break;
      excerpts = [{ path: survivor.path, content: survivor.content.slice(0, limit) }];
      input = build();
      tokens = measure(input);
    }
  }

  // 1c. Drop the last excerpt entirely.
  if (excerpts.length === 1 && tokens > budget) {
    excerpts = [];
    input = build();
    tokens = measure(input);
  }

  // 2. Diff-stat file rows — switch to churn-sorted order, then shrink the
  //    row count one at a time. Floor is the header line alone.
  if (tokens > budget && diffRowsTotal > 0) {
    sortDiffByChurn = true;
    while (diffFileLimit > 0 && tokens > budget) {
      diffFileLimit -= 1;
      input = build();
      tokens = measure(input);
    }
  }

  // 3. Blast-radius symbols — `status:`/`Endpoints:`/`Crons:` lines survive
  //    (buildBlastSummary never caps those), only the symbol list shrinks.
  if (tokens > budget && blastSymbolsTotal > 0) {
    while (symbolLimit > 0 && tokens > budget) {
      symbolLimit -= 1;
      input = build();
      tokens = measure(input);
    }
  }

  // 4. Linked-ticket body — title is never trimmed.
  if (tokens > budget && ticket?.body) {
    ticket = { title: ticket.title };
    ticketBodyDropped = true;
    input = build();
    tokens = measure(input);
  }

  return { input, trimmed: true, tokensBefore, tokens, budget, report: reportFor() };
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

    // Untrimmed renders, used only for the "signals" log line below — the
    // fitter re-renders its own (possibly trimmed) candidates independently.
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

    // Whole-prompt token budget (AC25-35) — measured immediately before the
    // structured call, after every signal above has been assembled.
    const fit = fitRiskBriefPromptToBudget(
      {
        title: pull.title,
        ...(description ? { description } : {}),
        ...(intent?.intent ? { intent: intent.intent } : {}),
        files,
        pull,
        blast,
        ...(ticket ? { ticket } : {}),
        planExcerpts,
      },
      container.tokenizer,
      RISK_BRIEF_PROMPT_TOKEN_BUDGET,
    );

    if (fit.tokens > RISK_BRIEF_PROMPT_TOKEN_BUDGET) {
      // AC34: exhausted the full trim ladder and still over budget — throw
      // here, before `extractRiskBrief` is ever reached, so the existing
      // `catch` below handles this exactly like today's degrade path (no LLM
      // call, no `upsertPrBrief`, prior cached brief left untouched).
      throw new Error(
        `PR risk brief: prompt exceeds the ${RISK_BRIEF_PROMPT_TOKEN_BUDGET}-token budget even after full ` +
          `trim (${fit.tokens} tokens)`,
      );
    }

    if (fit.trimmed) {
      const r = fit.report;
      logInfo(
        log,
        `PR risk brief: prompt trimmed — plan excerpts ${r.planExcerpts.kept}/${r.planExcerpts.total}, ` +
          `diff rows ${r.diffStatFiles.kept}/${r.diffStatFiles.total}, ` +
          `blast symbols ${r.blastSymbols.kept}/${r.blastSymbols.total}` +
          `${r.ticketBodyDropped ? ', ticket body dropped' : ''}; ` +
          `${fit.tokensBefore}→${fit.tokens} tokens (budget ${RISK_BRIEF_PROMPT_TOKEN_BUDGET})`,
        { prId: pull.id },
      );
    }

    const outcome = await extractRiskBrief({
      llm,
      model,
      ...fit.input,
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
