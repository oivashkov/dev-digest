import type { Finding, PrBlastRadius, Verdict } from '@devdigest/shared';
import { isApiClientException, type ApiClientError } from '../http/errors.js';

/**
 * The application-layer result ADT (Step 3 of `specs/mcp-server-plan.md`).
 * Every `McpService` method returns `ServiceResult<T>` instead of throwing —
 * this is the MCP-boundary equivalent of a route mapping a thrown error to a
 * status code, except the mapping target here is MCP `isError` content
 * (Step 4, `src/tools/*`, not owned by this file). `message` on a failure is
 * always written as the *next thing a calling agent should do*, never a bare
 * diagnostic — per the plan's "practice #4 (error-leads-forward)".
 *
 * This file (and everything under `src/service/**`) MUST NOT import
 * `@modelcontextprotocol/sdk` — see `docs/architecture.md` (Step 8) and the
 * plan's §4 dependency-direction rule.
 */

/**
 * Failure kinds surfaced to a tool handler. The six `ApiClientErrorKind`
 * values from `http/errors.ts` pass through 1:1-ish (see
 * `failureFromApiError` below for the couple of kinds that get folded
 * together), plus service-level kinds that have no HTTP-layer equivalent:
 * resolution misses (`repo_not_found`, `pr_not_found`, `agent_not_found`),
 * malformed tool input (`invalid_input`), the two `get_findings`-specific
 * gaps the plan calls out explicitly (`no_reviews_yet`, `run_not_found`),
 * and `run_failed` — `runAgentOnPr`'s poll loop detected (via
 * `DevDigestApiPort.listRuns`) that the run itself finished with
 * `status: 'failed' | 'cancelled'` server-side, distinct from `timeout`
 * (still running, budget exhausted) and from `http_error`/`unreachable`
 * (the DevDigest API call itself failed, not the run it started).
 */
export type FailureKind =
  | 'unreachable'
  | 'timeout'
  | 'rate_limited'
  | 'bad_response'
  | 'http_error'
  | 'invalid_input'
  | 'repo_not_found'
  | 'pr_not_found'
  | 'agent_not_found'
  | 'no_reviews_yet'
  | 'run_not_found'
  | 'run_failed';

export interface ServiceFailure {
  readonly kind: FailureKind;
  /** Next-step-oriented text for the calling agent — never a bare diagnostic. */
  readonly message: string;
}

export type ServiceResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly failure: ServiceFailure };

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail(kind: FailureKind, message: string): ServiceResult<never> {
  return { ok: false, failure: { kind, message } };
}

/**
 * Maps the infrastructure layer's `ApiClientError` (`http/errors.ts`, Step 2)
 * onto a next-step-oriented `ServiceFailure`. `not_found` folds into
 * `http_error` here (it already unwraps `ApiErrorBody.error.message`
 * verbatim at the HTTP layer — there is no more specific service-level
 * meaning to add generically; callers that need a sharper "repo/PR/agent not
 * found" message produce it themselves in `resolve.ts` BEFORE ever reaching
 * the API, since none of the DevDigest API's own 404s are reachable from a
 * pre-resolved id in this package's call pattern).
 */
export function failureFromApiError(error: ApiClientError): ServiceFailure {
  switch (error.kind) {
    case 'unreachable':
      return {
        kind: 'unreachable',
        message: 'Could not reach the DevDigest API — start it with `./scripts/dev.sh` and try again.',
      };
    case 'timeout':
      return {
        kind: 'timeout',
        message: 'The DevDigest API did not respond in time — it may be under load. Try again shortly.',
      };
    case 'rate_limited':
      return {
        kind: 'rate_limited',
        message:
          error.retryAfterSeconds !== undefined
            ? `Rate limited by the DevDigest API — retry in about ${error.retryAfterSeconds}s.`
            : 'Rate limited by the DevDigest API — wait a moment and retry.',
      };
    case 'not_found':
      return { kind: 'http_error', message: error.message };
    case 'bad_response':
      return {
        kind: 'bad_response',
        message: `The DevDigest API returned an unexpected response (${error.message}) — this looks like a bug, not something to retry.`,
      };
    case 'http_error':
      return {
        kind: 'http_error',
        message: `The DevDigest API returned an error (${error.statusCode}): ${error.message}`,
      };
  }
}

/**
 * Runs an HTTP-port call and turns a thrown `ApiClientException` into a typed
 * `ServiceFailure` instead of letting it propagate — the one place every
 * `src/service/**` call site funnels through so no raw `ApiClientException`
 * (or bare rejection) ever reaches `src/tools/*`. Re-throws anything that
 * isn't an `ApiClientException` (a genuine bug, not a mapped failure).
 */
export async function guardApiCall<T>(fn: () => Promise<T>): Promise<ServiceResult<T>> {
  try {
    return ok(await fn());
  } catch (err) {
    if (isApiClientException(err)) return { ok: false, failure: failureFromApiError(err.error) };
    throw err;
  }
}

// ---- Per-tool success payload shapes (trimmed, per `shape.ts`) -----------

export interface AgentSummary {
  id: string;
  name: string;
  model: string;
  enabled: boolean;
  strategy: string;
}

export interface ListAgentsData {
  agents: AgentSummary[];
}

export interface ConventionSummary {
  category: string;
  rule: string;
  /** `path:lines`, e.g. `src/foo.ts:12-31`. */
  evidence: string;
  confidence: number;
  accepted: boolean;
}

export interface GetConventionsData {
  scan_status: 'idle' | 'scanning' | 'failed';
  last_scan_at: string | null;
  conventions: ConventionSummary[];
  page: number;
  page_size: number;
  total: number;
  /** Present only when there is nothing to show because no scan has run yet. */
  message?: string;
}

export interface FindingSummary {
  severity: Finding['severity'];
  category: Finding['category'];
  title: string;
  file: string;
  line: number;
  rationale: string;
  suggestion?: string;
}

export interface GetFindingsData {
  run_id: string;
  verdict: Verdict | null;
  score: number | null;
  summary: string | null;
  findings: FindingSummary[];
  page: number;
  page_size: number;
  total: number;
}

export interface RunAgentOnPrCompleted {
  status: 'completed';
  run_id: string;
  verdict: Verdict | null;
  score: number | null;
  summary: string | null;
  findings: FindingSummary[];
  findings_count: number;
}

export interface RunAgentOnPrTimeout {
  status: 'timeout';
  /** Absent only in the rare case the initial POST itself timed out before a run id was ever observed. */
  run_id?: string;
  message: string;
}

export type RunAgentOnPrData = RunAgentOnPrCompleted | RunAgentOnPrTimeout;

/**
 * `PrBlastRadius` (`@devdigest/shared`) is already the concise, tool-facing
 * shape — grouped by symbol, with `counts`/`status`/`reason` carried
 * alongside the (possibly per-symbol-capped) arrays — so no further trimming
 * happens here, unlike `AgentSummary`/`ConventionSummary`/`FindingSummary`
 * above. `McpService.getBlastRadius`'s `file` narrowing (a pure client-side
 * filter, `src/service/index.ts`) also returns this same shape.
 */
export type GetBlastRadiusData = PrBlastRadius;
