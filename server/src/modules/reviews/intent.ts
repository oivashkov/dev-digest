import { resolve, sep } from 'node:path';
import type { Intent } from '@devdigest/shared';
import { classifyIntent, type IntentTicketInput, type PlanExcerptInput } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { RunLogger } from '../../platform/run-logger.js';
import type * as schema from '../../db/schema.js';
import type { PullRow } from '../../db/rows.js';
import { resolveFeatureModel } from '../settings/feature-models.js';

/**
 * Intent Layer — `getOrComputeIntent`, the single shared entry point behind
 * all three triggers described in `docs/plans/intent-layer.md` §2:
 *   A. `GET /pulls/:id/intent` (compute-if-missing, lazy on first PR open)
 *   B. `POST /pulls/:id/intent/refresh` (force recompute)
 *   C. `run-executor.ts`, once per review batch, before the per-agent loop
 *      (wired in THIS step; A/B are Step 5's `routes.ts`/`service.ts`)
 *
 * Signal-gathering, the path-traversal guard, and the deterministic
 * confidence tier all live here so they exist in exactly one place. Never
 * throws — any failure degrades to `undefined` (the caller proceeds without
 * an intent section / the GET route serves the previous cache or 404s).
 */

type RepoRow = typeof schema.repos.$inferSelect;

/** PR title/description length above which text counts as a real signal,
 *  not just a one-line stub (`"fix bug"`, `"wip"`). */
const MEANINGFUL_TEXT_MIN_CHARS = 40;

/** Cap on how many plan/spec references we'll resolve per PR — keeps the
 *  classifier prompt bounded even if the description links a dozen docs. */
const MAX_PLAN_REFS = 5;

/** Per-file truncation for a resolved plan/spec excerpt (~20KB, per plan §9's
 *  path-traversal risk section). */
const MAX_PLAN_EXCERPT_CHARS = 20_000;

/** How many changed-file lines to include in the diff-stat fallback. */
const MAX_DIFF_STAT_FILES = 20;

/**
 * Bounded timeout for the classifier LLM call — well under the provider's own
 * default (90s, see `reviewer-core/src/llm/openrouter.ts`) and under
 * `waitForPrRuns`-style poll windows elsewhere in this codebase. This call is
 * a best-effort pre-step (see `getOrComputeIntent`'s degrade-on-failure
 * contract below), so it must never be allowed to stall a review batch or a
 * `GET /pulls/:id/intent` request anywhere near as long as the provider would
 * otherwise wait.
 */
const INTENT_CLASSIFY_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Logging — dual shape, per docs/plans/intent-layer.md §8.
//
// Trigger C (this step) passes a `RunLogger` (`.info(msg, data?)`, no
// `.warn` — matches `buildCallersDigest`/`buildRepoMapDigest`'s existing
// degrade-to-info convention in `run-executor.ts`). Triggers A/B (Step 5,
// NOT implemented here) will pass Fastify's pino-style request logger
// (`.info(obj, msg?)`, `.warn(obj, msg?)` — object first, unlike
// `RunLogger`). `IntentLog` accepts either shape structurally; `logInfo`/
// `logWarn` below normalize the call so callers of `getOrComputeIntent`
// never need their own adapter.
// ---------------------------------------------------------------------------

export type IntentLog = RunLogger | { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };

function isRunLogger(log: IntentLog): log is RunLogger {
  return typeof (log as RunLogger).step === 'function';
}

function logInfo(log: IntentLog, msg: string, data?: unknown): void {
  if (isRunLogger(log)) log.info(msg, data);
  else log.info(data, msg);
}

function logWarn(log: IntentLog, msg: string, data?: unknown): void {
  // RunLogger has no `.warn` — every other best-effort helper in
  // run-executor.ts (buildCallersDigest, buildRepoMapDigest, buildRankNote)
  // reports its own failures via `.info`, never `.error` (which would mark
  // the Live Log red for a non-fatal degrade). Match that convention.
  if (isRunLogger(log)) log.info(msg, data);
  else log.warn(data, msg);
}

// ---------------------------------------------------------------------------
// Deterministic confidence tier (never a model self-report) — the same
// "never trust a self-report" principle as `groundFindings()`/
// `scoreFromFindings()` in reviewer-core. See docs/plans/intent-layer.md,
// "Архітектурні рішення" point 1.
// ---------------------------------------------------------------------------

export interface TierSignals {
  /** A plan/spec reference from the PR description or linked ticket was
   *  found AND successfully read from the repo. */
  hasResolvedPlanRef: boolean;
  /** The linked ticket (if any) has a non-empty body. */
  hasTicketBody: boolean;
  /** The PR description is present and non-trivial (> MEANINGFUL_TEXT_MIN_CHARS). */
  hasDescription: boolean;
}

export function tierFor(signals: TierSignals): { confidence: number; source: Intent['source'] } {
  if (signals.hasResolvedPlanRef) return { confidence: 0.9, source: 'spec' };
  if (signals.hasTicketBody) return { confidence: 0.9, source: 'ticket' };
  if (signals.hasDescription) return { confidence: 0.6, source: 'description' };
  return { confidence: 0.25, source: 'inferred' };
}

function isMeaningfulText(text: string | undefined): boolean {
  return !!text && text.trim().length > MEANINGFUL_TEXT_MIN_CHARS;
}

// ---------------------------------------------------------------------------
// Plan/spec reference extraction + path-traversal guard.
//
// `GitClient.readFile` (`src/adapters/git/simple-git.ts`) does a bare
// `join(clonePathFor(repo), path)` with NO containment check — the path here
// comes straight from untrusted PR/ticket text, so EVERY candidate MUST pass
// both the shape allowlist and the containment check below BEFORE it ever
// reaches `readFile`. See docs/plans/intent-layer.md §9 ("Path traversal").
// ---------------------------------------------------------------------------

const SPECS_MD_RE = /(^|\/)specs\/[^/]+\.md$/;
const DOCS_MD_RE = /(^|\/)docs\/.+\.md$/;
const DOCS_PLANS_RE = /(^|\/)docs\/plans\//;

/** Extract candidate file-path-looking tokens from free text — bare paths
 *  and paths inside markdown links `[text](path)` alike (splitting on
 *  brackets/parens/whitespace pulls the path out of either form). */
function extractPlanRefCandidates(text: string): string[] {
  const tokens = text.match(/[^\s()<>[\]]+/g) ?? [];
  return tokens.map((t) => t.replace(/[.,;:!?]+$/, '')).filter((t) => t.includes('/'));
}

/** Shape allowlist: `**\/specs/*.md`, `**\/docs/**\/*.md`, `docs/plans/**`
 *  (the same "doc-root" pattern as root `AGENTS.md`) — and rejects any
 *  absolute path or `..` segment outright, regardless of shape. */
export function isAllowedPlanRefShape(path: string): boolean {
  if (path.includes('..')) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[A-Za-z]:[\\/]/.test(path)) return false; // defensive: windows drive-absolute
  return SPECS_MD_RE.test(path) || DOCS_MD_RE.test(path) || DOCS_PLANS_RE.test(path);
}

/** Containment check: the resolved path must stay inside `clonePath`. Belt-
 *  and-braces alongside the shape allowlist and the `..` rejection above. */
export function isWithinClone(clonePath: string, relPath: string): boolean {
  const base = resolve(clonePath);
  const resolved = resolve(base, relPath);
  return resolved === base || resolved.startsWith(base + sep);
}

/** Combined guard — shape AND containment — used before every `readFile`
 *  call. Exported so the traversal-payload cases can be unit-tested
 *  directly without spinning up a real clone. */
export function isSafePlanRefPath(clonePath: string, relPath: string): boolean {
  return isAllowedPlanRefShape(relPath) && isWithinClone(clonePath, relPath);
}

async function resolvePlanRefs(
  container: Container,
  repo: RepoRow,
  texts: string[],
  log: IntentLog,
): Promise<PlanExcerptInput[]> {
  const clonePath = container.git.clonePathFor(repo);
  const candidates = new Set<string>();
  for (const text of texts) {
    for (const c of extractPlanRefCandidates(text)) candidates.add(c);
  }
  if (candidates.size === 0) return [];

  const excerpts: PlanExcerptInput[] = [];
  let rejected = 0;
  for (const candidate of candidates) {
    if (excerpts.length >= MAX_PLAN_REFS) break;
    if (!isSafePlanRefPath(clonePath, candidate)) {
      rejected += 1;
      continue;
    }
    try {
      const content = await container.git.readFile(repo, candidate);
      excerpts.push({ path: candidate, content: content.slice(0, MAX_PLAN_EXCERPT_CHARS) });
    } catch {
      // File doesn't exist at this ref / repo not cloned yet — skip silently,
      // per docs/plans/intent-layer.md §1 ("read failures... skip silently").
    }
  }
  if (candidates.size > 0) {
    logInfo(
      log,
      `PR intent: plan/spec refs — ${candidates.size} candidate(s) found, ${excerpts.length} resolved, ${rejected} rejected by path guard`,
    );
  }
  return excerpts;
}

// ---------------------------------------------------------------------------
// Linked ticket (live fetch — `linked_issue` is not persisted on `PullRow`).
// ---------------------------------------------------------------------------

async function fetchTicket(
  container: Container,
  repo: RepoRow,
  prNumber: number,
): Promise<IntentTicketInput | undefined> {
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
// Diff-stat fallback — only built when there's no meaningful description,
// ticket body, or resolved plan ref (the low-confidence "inferred" tier).
// Uses `pull.filesCount`/`additions`/`deletions` (already on `PullRow`, no
// extra I/O) plus, best-effort, the per-file list already persisted for this
// PR (`ReviewRepository.getPrFiles`) — never re-fetches the whole diff.
// ---------------------------------------------------------------------------

async function buildDiffStatFallback(container: Container, pull: PullRow): Promise<string | undefined> {
  if (pull.filesCount === 0 && pull.additions === 0 && pull.deletions === 0) return undefined;
  const header = `${pull.filesCount} file(s) changed (+${pull.additions}/-${pull.deletions})`;
  try {
    const files = await container.reviewRepo.getPrFiles(pull.id);
    if (files.length === 0) return header;
    const lines = files.slice(0, MAX_DIFF_STAT_FILES).map((f) => `- ${f.path} (+${f.additions}/-${f.deletions})`);
    return `${header}\n${lines.join('\n')}`;
  } catch {
    return header;
  }
}

// ---------------------------------------------------------------------------
// getOrComputeIntent — the shared entry point.
// ---------------------------------------------------------------------------

/** In-flight de-dup, keyed by PR id — a second near-simultaneous call (e.g. a
 *  client double-render) shares the one computation already running instead
 *  of firing a second LLM call. Best-effort, process-local (no distributed
 *  lock needed per docs/plans/intent-layer.md §2). */
const inflight = new Map<string, Promise<Intent | undefined>>();

export async function getOrComputeIntent(
  container: Container,
  workspaceId: string,
  repo: RepoRow,
  pull: PullRow,
  opts: { force: boolean },
  log: IntentLog,
): Promise<Intent | undefined> {
  if (!opts.force) {
    try {
      const cached = await container.reviewRepo.getIntent(pull.id);
      if (cached) {
        logInfo(log, `PR intent: reusing cached result (source=${cached.source ?? 'unknown'})`, { prId: pull.id });
        return cached;
      }
    } catch (err) {
      // A broken cache read shouldn't block a fresh compute below.
      logWarn(log, `PR intent: cache read failed — computing fresh (${(err as Error).message})`, { prId: pull.id });
    }
  }

  const existing = inflight.get(pull.id);
  if (existing) return existing;

  const promise = computeIntent(container, workspaceId, repo, pull, log).finally(() => {
    inflight.delete(pull.id);
  });
  inflight.set(pull.id, promise);
  return promise;
}

async function computeIntent(
  container: Container,
  workspaceId: string,
  repo: RepoRow,
  pull: PullRow,
  log: IntentLog,
): Promise<Intent | undefined> {
  const start = Date.now();
  logInfo(log, `PR intent: classifying PR #${pull.number}`, { prId: pull.id });

  try {
    const description = pull.body?.trim() || undefined;
    const hasDescription = isMeaningfulText(description);

    const ticket = await fetchTicket(container, repo, pull.number);
    const hasTicketBody = !!ticket?.body && ticket.body.trim().length > 0;

    const planExcerpts = await resolvePlanRefs(
      container,
      repo,
      [description, ticket?.body].filter((t): t is string => !!t),
      log,
    );
    const hasResolvedPlanRef = planExcerpts.length > 0;

    logInfo(
      log,
      `PR intent: signals — description=${hasDescription} ticket=${!!ticket} ticketBody=${hasTicketBody} planRefs=${planExcerpts.length}`,
      { prId: pull.id },
    );

    let diffStat: string | undefined;
    if (!hasResolvedPlanRef && !hasTicketBody && !hasDescription) {
      diffStat = await buildDiffStatFallback(container, pull);
    }

    const { provider, model } = await resolveFeatureModel(container, workspaceId, 'review_intent');
    const llm = await container.llm(provider);
    logInfo(log, `PR intent: model resolved — ${provider}/${model}`, { prId: pull.id });

    const outcome = await classifyIntent({
      llm,
      model,
      title: pull.title,
      ...(description ? { description } : {}),
      ...(ticket ? { ticket } : {}),
      ...(planExcerpts.length > 0 ? { planExcerpts } : {}),
      ...(diffStat ? { diffStat } : {}),
      sessionId: `${repo.owner}/${repo.name}#${pull.number}:intent`,
      timeoutMs: INTENT_CLASSIFY_TIMEOUT_MS,
    });

    const tier = tierFor({ hasResolvedPlanRef, hasTicketBody, hasDescription });
    const intent: Intent = {
      ...outcome.extraction,
      confidence: tier.confidence,
      source: tier.source,
      plan_refs: planExcerpts.map((e) => e.path),
    };

    await container.reviewRepo.upsertIntent(pull.id, intent);

    logInfo(
      log,
      `PR intent: classified — tier=${tier.source} confidence=${tier.confidence} (${Date.now() - start}ms, cost=${outcome.costUsd ?? 'n/a'})`,
      { prId: pull.id, tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut },
    );

    return intent;
  } catch (err) {
    logWarn(
      log,
      `PR intent: classification failed — proceeding without intent section (${(err as Error).message})`,
      { prId: pull.id },
    );
    return undefined;
  }
}
