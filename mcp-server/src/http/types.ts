import type {
  Agent,
  ConventionsState,
  PrBlastRadius,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunRequest,
  RunSummary,
} from '@devdigest/shared';

/**
 * Construction options for `DevDigestApiClient` (`client.ts`). Values come
 * from `config.ts` via the composition root (`src/server.ts`, Step 5) —
 * never read from `process.env` in this layer.
 */
export interface HttpClientOptions {
  /** Base URL of the local DevDigest Fastify API, e.g. http://localhost:3001. */
  baseUrl: string;
  /** Per-request timeout (ms) applied to every individual HTTP call. */
  requestTimeoutMs: number;
}

/**
 * The DevDigest API surface the application service (`src/service/**`,
 * Step 3) depends on — independent of the concrete `fetch`-based
 * implementation in `client.ts`. Mirrors the `server/src/adapters/*` port
 * pattern (`backend-onion-architecture` skill): the service constructor
 * takes this interface, so tests swap in a mock implementing it instead of
 * mocking `fetch` at the service layer.
 *
 * Every method returns already-validated `@devdigest/shared` data or throws
 * an `ApiClientException` (`errors.ts`) — never a raw/untyped rejection.
 */
export interface DevDigestApiPort {
  /** GET /agents */
  listAgents(): Promise<Agent[]>;
  /** GET /repos */
  listRepos(): Promise<Repo[]>;
  /** GET /repos/:id/pulls */
  listPulls(repoId: string): Promise<PrMeta[]>;
  /** POST /pulls/:id/review — synchronous: completed reviews are usually in the response. */
  runReview(pullId: string, body: RunRequest): Promise<ReviewRunResponse>;
  /** GET /pulls/:id/reviews */
  listReviews(pullId: string): Promise<ReviewRecord[]>;
  /**
   * GET /pulls/:id/runs — every `agent_runs` row for this PR, any status
   * (`running` | `done` | `failed` | `cancelled` | null), newest-started
   * first. Distinct from `listReviews`: this is the run *ledger* (status +
   * `error`, no findings), so `runAgentOnPr`'s poll loop can detect a
   * server-side run failure directly instead of waiting out the full
   * timeout budget and reporting a misleading "still running".
   */
  listRuns(pullId: string): Promise<RunSummary[]>;
  /** GET /repos/:id/conventions */
  getConventions(repoId: string): Promise<ConventionsState>;
  /**
   * GET /pulls/:id/blast — symbols declared in the PR's changed files, their
   * resolved callers, and the endpoints/crons reachable within a 2-level
   * reverse import walk. Deterministic (no LLM call) — see
   * `docs/plans/blast-radius.md`.
   */
  getBlastRadius(pullId: string): Promise<PrBlastRadius>;
}
