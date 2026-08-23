import type { PrBlastRadius, ReviewRecord, RunSummary } from '@devdigest/shared';
import { isApiClientException } from '../http/errors.js';
import type { DevDigestApiPort } from '../http/types.js';
import { resolveAgent, resolvePr, resolveRepo } from './resolve.js';
import { failureFromApiError, fail, guardApiCall, ok } from './results.js';
import type {
  GetBlastRadiusData,
  GetConventionsData,
  GetFindingsData,
  ListAgentsData,
  RunAgentOnPrData,
  ServiceResult,
} from './results.js';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, paginate, trimAgent, trimConvention, trimFinding } from './shape.js';

/** Run policy for `runAgentOnPr`'s poll/timeout-fallback orchestration — fed from `config.ts` via the composition root (Step 5). */
export interface McpServiceOptions {
  /** How often to poll `GET /pulls/:id/runs` (failure detection) and `GET /pulls/:id/reviews` (completion) while waiting for a run to finish. */
  pollIntervalMs: number;
  /** Hard ceiling, measured from the start of `runAgentOnPr` (including the initial POST), before returning a timeout-fallback result. */
  hardTimeoutMs: number;
}

/**
 * The application/domain layer (Step 3 of `specs/mcp-server-plan.md`) — one
 * method per MCP tool. Constructed with the HTTP client port (`DevDigestApiPort`,
 * Step 2) + run policy via constructor injection, so it is testable with a
 * mocked port and zero MCP machinery. MUST NOT import
 * `@modelcontextprotocol/sdk` — see `docs/architecture.md` (Step 8).
 *
 * `POST /pulls/:id/review` is fire-and-forget on the server (confirmed
 * against `server/src/modules/reviews/service.ts#runReview`, which does
 * `void this.executor.executeRuns(...)` and returns immediately with
 * `reviews: []`) — NOT synchronous-with-populated-reviews as this package's
 * own plan (§4) assumed from the route's docstring. `runAgentOnPr` therefore
 * always polls `GET /pulls/:id/runs` (run status/failure, via
 * `DevDigestApiPort.listRuns`) and `GET /pulls/:id/reviews` (the completed
 * result) for the real outcome; see the method doc comment below and
 * `mcp-server/INSIGHTS.md` for the full finding.
 */
export class McpService {
  constructor(
    private readonly client: DevDigestApiPort,
    private readonly options: McpServiceOptions,
  ) {}

  async listAgents(): Promise<ServiceResult<ListAgentsData>> {
    const result = await guardApiCall(() => this.client.listAgents());
    if (!result.ok) return result;
    return ok({ agents: result.data.map(trimAgent) });
  }

  async getConventions(repo: string, page?: number): Promise<ServiceResult<GetConventionsData>> {
    const repoResult = await resolveRepo(this.client, repo);
    if (!repoResult.ok) return repoResult;

    const conventionsResult = await guardApiCall(() => this.client.getConventions(repoResult.data.id));
    if (!conventionsResult.ok) return conventionsResult;
    const state = conventionsResult.data;

    const { items, page: p, pageSize, total } = paginate(state.candidates.map(trimConvention), page);
    return ok({
      scan_status: state.scan_status,
      last_scan_at: state.last_scan_at,
      conventions: items,
      page: p,
      page_size: pageSize,
      total,
      ...(state.scan_status === 'idle' && total === 0
        ? {
            message:
              'This repo has not been scanned for conventions yet — trigger a conventions scan in the studio to populate this list.',
          }
        : {}),
    });
  }

  /**
   * Resolves `repo`+`pr`, then reads `GET /pulls/:id/reviews` and picks the
   * review matching `runId`, or the most recent one otherwise. Never returns
   * an empty `findings: []` silently — a PR with zero completed reviews is a
   * `no_reviews_yet` failure, and an unmatched `runId` is a `run_not_found`
   * failure, so a calling agent can't mistake "hasn't run yet" for "ran,
   * clean" (both would otherwise look like an empty findings array).
   */
  async getFindings(
    repo: string,
    pr: string | number,
    runId?: string,
    page?: number,
    pageSize?: number,
  ): Promise<ServiceResult<GetFindingsData>> {
    const repoResult = await resolveRepo(this.client, repo);
    if (!repoResult.ok) return repoResult;
    const prResult = await resolvePr(this.client, repoResult.data.id, pr);
    if (!prResult.ok) return prResult;
    // resolvePr already rejects a PR whose `id` is missing (`bad_response`),
    // so this is always a string here.
    const pullId = prResult.data.id as string;

    const reviewsResult = await guardApiCall(() => this.client.listReviews(pullId));
    if (!reviewsResult.ok) return reviewsResult;
    const reviews = reviewsResult.data
      .filter((r) => r.kind === 'review')
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    if (reviews.length === 0) {
      return fail('no_reviews_yet', 'No completed review found for this PR yet — call run_agent_on_pr to start one.');
    }

    let target: ReviewRecord;
    if (runId) {
      const match = reviews.find((r) => r.run_id === runId);
      if (!match) {
        return fail(
          'run_not_found',
          `No review found for run_id ${runId} on this PR — call get_findings without run_id to see the most recent review, or run_agent_on_pr to start a new run.`,
        );
      }
      target = match;
    } else {
      target = reviews[0] as ReviewRecord;
    }

    if (!target.run_id) {
      return fail('bad_response', 'The matched review is missing its run_id — this looks like a server-side data issue.');
    }

    const { items, page: p, pageSize: ps, total } = paginate(target.findings.map(trimFinding), page, pageSize);
    return ok({
      run_id: target.run_id,
      verdict: target.verdict,
      score: target.score,
      summary: target.summary,
      findings: items,
      page: p,
      page_size: ps,
      total,
    });
  }

  /**
   * Resolves `repo`+`pr`+`agent`, then `POST /pulls/:id/review { agentId }`.
   *
   * That endpoint's own response never carries the completed review in
   * practice (see the class doc comment — it's fire-and-forget server-side),
   * so this always falls through to polling `GET /pulls/:id/reviews` for the
   * run id the POST handed back, checked every `pollIntervalMs` until
   * `hardTimeoutMs` (measured from the start of this call, including the
   * initial POST) — then returns a `{status:'timeout'}` result, never a bare
   * error, per the plan's practice #4 applied to timeout.
   *
   * If the POST itself throws a `timeout`-kind `ApiClientException` (the
   * per-request `requestTimeoutMs` — much smaller than `hardTimeoutMs` —
   * elapsed before the DevDigest API even acknowledged the request), the run
   * id is unknown; this still falls through to polling for the remaining
   * budget. A match can't be correlated by run id in that case, so the poll
   * loop instead correlates by `agentId` + "started at/after this call's
   * `startedAt`" against `GET /pulls/:id/runs` (see `findOwnRun` below) —
   * and if the budget runs out before either a run id or a completed review
   * is confirmed, the timeout result says so explicitly rather than
   * guessing.
   *
   * Failure detection (fixed — see `mcp-server/INSIGHTS.md`): a run that
   * fails server-side (bad LLM key, cancelled, etc.) never produces a row in
   * `GET /pulls/:id/reviews` — the server only records that outcome in
   * `agent_runs.status`/`error`, reachable via `GET /pulls/:id/runs`
   * (`DevDigestApiPort.listRuns`). Each poll iteration checks that ledger
   * BEFORE checking for a completed review: `status: 'failed' | 'cancelled'`
   * returns an immediate typed `run_failed` failure (never silently
   * reclassified as a timeout); `status: 'running'` keeps polling;
   * `status: 'done'` is left for the existing `listReviews` check on the
   * same iteration to pick up (it already carries the full findings/verdict
   * payload `listRuns` doesn't).
   */
  async runAgentOnPr(repo: string, pr: string | number, agent: string): Promise<ServiceResult<RunAgentOnPrData>> {
    const repoResult = await resolveRepo(this.client, repo);
    if (!repoResult.ok) return repoResult;
    const prResult = await resolvePr(this.client, repoResult.data.id, pr);
    if (!prResult.ok) return prResult;
    const agentResult = await resolveAgent(this.client, agent);
    if (!agentResult.ok) return agentResult;

    const pullId = prResult.data.id as string;
    const agentId = agentResult.data.id;
    const startedAt = Date.now();

    let runId: string | undefined;
    try {
      const response = await this.client.runReview(pullId, { agentId });
      const target = response.runs.find((r) => r.agent_id === agentId) ?? response.runs[0];
      runId = target?.run_id;
      if (runId) {
        // Defensive: in case a future server version does return the
        // completed review synchronously, don't poll for it needlessly.
        const immediate = response.reviews.find((r) => r.run_id === runId);
        if (immediate) return ok(this.completedFromReview(immediate));
      }
    } catch (err) {
      if (!isApiClientException(err)) throw err;
      if (err.error.kind !== 'timeout') {
        return { ok: false, failure: failureFromApiError(err.error) };
      }
      // kind === 'timeout': fall through to the poll loop below with runId
      // still undefined — see the method doc comment.
    }

    while (Date.now() - startedAt < this.options.hardTimeoutMs) {
      await sleep(this.options.pollIntervalMs);

      // Check the run ledger first so a server-side failure is reported
      // immediately instead of silently waiting out the full timeout
      // budget and misreporting it as "still running".
      const runsResult = await guardApiCall(() => this.client.listRuns(pullId));
      if (runsResult.ok) {
        const currentRun = runId
          ? runsResult.data.find((r) => r.run_id === runId)
          : findOwnRun(runsResult.data, agentId, startedAt);
        if (currentRun?.run_id && !runId) runId = currentRun.run_id;
        if (currentRun?.status === 'failed' || currentRun?.status === 'cancelled') {
          const label = currentRun.status === 'cancelled' ? 'was cancelled' : 'failed';
          return fail(
            'run_failed',
            `Run ${currentRun.run_id} ${label}${currentRun.error ? `: ${currentRun.error}` : ' (no error detail available)'}. Check server logs or retry with run_agent_on_pr.`,
          );
        }
        // status === 'running' (or unresolved) — fall through to the
        // completed-review check below for this same iteration.
      }
      // A transient `listRuns` read failure mid-poll shouldn't abort the
      // whole orchestration — keep polling until the budget runs out; if we
      // never succeed, the loop simply ends and we report the fallback.

      const reviewsResult = await guardApiCall(() => this.client.listReviews(pullId));
      if (!reviewsResult.ok) {
        // Same rationale as above: a transient read failure mid-poll
        // shouldn't abort the whole orchestration.
        continue;
      }
      const match = runId
        ? reviewsResult.data.find((r) => r.run_id === runId && r.kind === 'review')
        : undefined;
      if (match) return ok(this.completedFromReview(match));
    }

    return ok({
      status: 'timeout',
      ...(runId ? { run_id: runId } : {}),
      message: runId
        ? `Review still running after ${Math.round(this.options.hardTimeoutMs / 1000)}s. Call get_findings with repo=${repo} pr=${pr} run_id=${runId} once it finishes.`
        : `The review request to the DevDigest API timed out before a run id could be confirmed. It may still be running — call get_findings with repo=${repo} pr=${pr} in a bit to check for a new review, or retry run_agent_on_pr.`,
    } satisfies RunAgentOnPrData);
  }

  /**
   * Resolves `repo`, then (unlike the tool's `inputSchema`, which marks `pr`
   * optional for input-shape symmetry with the other tools) requires `pr` —
   * there is no repo-wide blast radius, only a per-PR one — before calling
   * `GET /pulls/:id/blast` (`DevDigestApiPort.getBlastRadius`). `file`, when
   * given, narrows the response to symbols declared in that file: a pure
   * client-side filter (`filterBlastRadiusByFile` below) — the server route
   * has no `?file=` param (`docs/plans/blast-radius.md` §4 "Поза скоупом",
   * §6 Step 5.3).
   *
   * The missing-`pr` check runs BEFORE `resolveRepo`/any HTTP call, mirroring
   * `resolve.ts`'s own convention of rejecting malformed input before
   * touching the network (e.g. `resolveRepo`'s empty-string check ahead of
   * `listRepos`).
   */
  async getBlastRadius(
    repo: string,
    pr?: string | number,
    file?: string,
  ): Promise<ServiceResult<GetBlastRadiusData>> {
    if (pr === undefined) {
      return fail(
        'invalid_input',
        'get_blast_radius needs a PR to analyze — pass pr=<number> to look up its blast radius.',
      );
    }

    const repoResult = await resolveRepo(this.client, repo);
    if (!repoResult.ok) return repoResult;
    const prResult = await resolvePr(this.client, repoResult.data.id, pr);
    if (!prResult.ok) return prResult;
    const pullId = prResult.data.id as string;

    const blastResult = await guardApiCall(() => this.client.getBlastRadius(pullId));
    if (!blastResult.ok) return blastResult;

    return ok(file ? filterBlastRadiusByFile(blastResult.data, file) : blastResult.data);
  }

  private completedFromReview(review: ReviewRecord): RunAgentOnPrData {
    const findings = review.findings.map(trimFinding);
    return {
      status: 'completed',
      run_id: review.run_id ?? '',
      verdict: review.verdict,
      score: review.score,
      summary: review.summary,
      findings,
      findings_count: findings.length,
    };
  }
}

/**
 * Correlates the run kicked off by this call to a `GET /pulls/:id/runs` row
 * when the run id itself is unknown (the initial POST's own per-request
 * timeout fired before the response — and therefore the run id — was ever
 * observed; see `runAgentOnPr`'s doc comment). `listRuns` returns rows
 * newest-started-first (`ran_at` DESC, set at row insertion — i.e. run
 * start, not completion); this picks the most recent row for the same
 * `agentId` whose `ran_at` is at/after `startedAt`, which is the run this
 * call itself triggered unless another run for the same agent started on
 * this PR in the same instant (an accepted, narrow race given `ran_at`'s
 * second-level precision).
 */
function findOwnRun(runs: RunSummary[], agentId: string, startedAt: number): RunSummary | undefined {
  return runs.find(
    (r) => r.agent_id === agentId && r.ran_at !== null && new Date(r.ran_at).getTime() >= startedAt,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Narrows a `PrBlastRadius` to only the symbols declared in `file`, and
 * recomputes `impacted_endpoints`/`impacted_crons`/`counts` from that
 * narrower set — a scoped response must never claim endpoints/crons/counts
 * that came from a symbol outside `file`. `status`/`reason` pass through
 * unchanged: `file` narrows *scope*, not index completeness. Pure — no I/O.
 */
function filterBlastRadiusByFile(data: PrBlastRadius, file: string): PrBlastRadius {
  const symbols = data.symbols.filter((symbol) => symbol.file === file);
  const endpoints = dedupe(symbols.flatMap((symbol) => symbol.endpoints));
  const crons = dedupe(symbols.flatMap((symbol) => symbol.crons));
  const callers = symbols.reduce((sum, symbol) => sum + symbol.callers.length, 0);
  return {
    ...data,
    symbols,
    impacted_endpoints: endpoints,
    impacted_crons: crons,
    counts: {
      symbols: symbols.length,
      callers,
      endpoints: endpoints.length,
      crons: crons.length,
    },
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

// Re-exported so callers of the facade only need `import { McpService } from './service/index.js'`
// for the common defaults, per `shape.ts`'s pagination contract.
export { DEFAULT_PAGE, DEFAULT_PAGE_SIZE };
