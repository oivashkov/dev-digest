import type { Container } from '../../platform/container.js';
import type {
  FindingActionKind,
  PrBlastRadius,
  PrIntentRecord,
  RunEventKind,
  RunTrace,
  SmartDiff,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';
import { getOrComputeIntent as getOrComputeIntentImpl, computeScopeDrift } from './intent.js';
import { buildSmartDiff } from './smart-diff.js';
import { buildPrBlastRadius } from './blast.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }

  // ===========================================================================
  // PR intent (Intent Layer, triggers A/B — lazy compute-if-missing + refresh)
  // ===========================================================================

  /**
   * `GET /pulls/:id/intent` (opts.force=false) and `POST
   * /pulls/:id/intent/refresh` (opts.force=true) both land here. Resolves the
   * PR + repo the same way `runReview` does, then delegates all
   * signal-gathering/tiering/caching to the shared `getOrComputeIntent`
   * (`./intent.js`) — this method's only job is workspace-scoped lookup +
   * shaping the `PrIntentRecord` response (`Intent` + `pr_id` +
   * `scope_drift`). Throws `NotFoundError` when the PR doesn't exist OR when
   * computation couldn't produce a result (no cache and the fresh compute
   * degraded to `undefined`) — both map to a 404 via the shared error
   * handler.
   *
   * `scope_drift` is deliberately NOT part of the cached `Intent`/`pr_intent`
   * — it's recomputed fresh from the PR's CURRENT changed-file list on every
   * call (cheap, deterministic, no LLM), so it stays live even when the
   * cached `intent`/`out_of_scope` itself is stale. See
   * docs/plans/intent-scope-drift.md §3.
   */
  async getOrComputeIntent(
    workspaceId: string,
    prId: string,
    opts: { force: boolean },
    log: Logger,
  ): Promise<PrIntentRecord> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const intent = await getOrComputeIntentImpl(this.container, workspaceId, repo, pull, opts, log);
    if (!intent) throw new NotFoundError('PR intent not available');

    const files = await this.repo.getPrFiles(prId);
    const scopeDrift = computeScopeDrift(
      files.map((f) => ({ path: f.path })),
      intent.out_of_scope,
    );

    return { ...intent, pr_id: prId, scope_drift: scopeDrift };
  }

  // ===========================================================================
  // SmartDiff (deterministic, no LLM — recomputed fresh on every call, no
  // caching table; see `docs/plans/smart-diff.md` §3/§4)
  // ===========================================================================

  /**
   * `GET /pulls/:id/smart-diff`. Workspace-scoped PR lookup (same pattern as
   * `reviewsForPull`/`getOrComputeIntent`), then feeds the PR's changed files
   * and the newest review's non-dismissed findings into the pure
   * `buildSmartDiff` classifier. Always resolves — `groups` is empty only when
   * the PR itself has no changed files; there is no compute-if-missing/404
   * semantics like intent's, because this is a free, instant computation, not
   * a cached LLM result.
   */
  async getSmartDiff(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.getPrFiles(prId);
    const reviews = await this.repo.reviewsForPull(prId);
    const latestFindings = reviews[0]?.findings ?? [];
    const findings = latestFindings.filter((f) => f.dismissedAt == null);

    return buildSmartDiff(
      files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
      findings.map((f) => ({ file: f.file, start_line: f.startLine, end_line: f.endLine })),
    );
  }

  // ===========================================================================
  // Blast radius (deterministic, no LLM — recomputed fresh on every call, no
  // caching table; see `docs/plans/blast-radius.md` Step 3)
  // ===========================================================================

  /**
   * `GET /pulls/:id/blast`. Workspace-scoped PR lookup (same pattern as
   * `getSmartDiff`), then the SAME `getPrFiles` call `getSmartDiff`/intent
   * already use to get the PR's changed-file paths — no new way to obtain
   * them. Fetches `repoIntel.getBlastRadius` (the actual result) and
   * `repoIntel.getIndexState` (needed ONLY to tell `full` apart from
   * `partial`, since `tryPersistentBlast` returns `degraded: false` for both
   * — see `repo-intel/service.ts:320`) in parallel, then hands both to the
   * pure `buildPrBlastRadius` mapper.
   */
  async getBlastRadius(workspaceId: string, prId: string): Promise<PrBlastRadius> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.getPrFiles(prId);
    const paths = files.map((f) => f.path);

    const [result, indexState] = await Promise.all([
      this.container.repoIntel.getBlastRadius(pull.repoId, paths),
      this.container.repoIntel.getIndexState(pull.repoId),
    ]);

    return buildPrBlastRadius({ prId, repoId: pull.repoId, result, indexState });
  }
}
