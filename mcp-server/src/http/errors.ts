import type { ZodIssue } from 'zod';

/**
 * Typed error taxonomy for every failure `DevDigestApiClient` (`client.ts`)
 * can produce — the infrastructure layer's equivalent of
 * `server/src/adapters/*` throwing a typed error instead of a bare
 * `Error`/`string`. This layer does NOT know about MCP `isError`; turning a
 * `kind` into a next-step-oriented message for a calling agent is the
 * application service's job (`src/service/**`, Step 3). Per the plan
 * (`specs/mcp-server-plan.md` §5 Step 2), the intended mapping is:
 *
 *   - `unreachable`  → "start it with `./scripts/dev.sh`"
 *   - `rate_limited` → a retry-oriented message (10 req/min on the review
 *     endpoint per `server/README.md`)
 *   - `not_found`    → surfaces `error.message` (already unwrapped from
 *     `ApiErrorBody.error.message`) verbatim
 *   - `bad_response` → schema drift / invalid JSON — a bug-report-oriented
 *     message, not something the calling agent can retry its way out of
 *
 * `timeout` and `http_error` are additions beyond the plan's four named
 * kinds, needed for a client that must distinguish "the server never
 * responded within the per-request timeout" (`timeout` — relevant to Step
 * 3's poll/timeout-fallback orchestration for `run_agent_on_pr`) from
 * "the server actively refused the connection" (`unreachable`), and to keep
 * the union exhaustive for any non-2xx status the other kinds don't cover
 * (`http_error`).
 */
export type ApiClientErrorKind =
  | 'unreachable'
  | 'timeout'
  | 'rate_limited'
  | 'not_found'
  | 'bad_response'
  | 'http_error';

interface ApiClientErrorBase {
  readonly kind: ApiClientErrorKind;
  /**
   * Diagnostic message. This is developer-facing context (what happened,
   * for logs/debugging) — NOT the next-step MCP-facing text; see the module
   * doc comment above for who owns that mapping.
   */
  readonly message: string;
}

export interface UnreachableApiError extends ApiClientErrorBase {
  readonly kind: 'unreachable';
  readonly cause: unknown;
}

export interface TimeoutApiError extends ApiClientErrorBase {
  readonly kind: 'timeout';
  readonly timeoutMs: number;
}

export interface RateLimitedApiError extends ApiClientErrorBase {
  readonly kind: 'rate_limited';
  /** From the `Retry-After` response header, when the server sends one. */
  readonly retryAfterSeconds?: number;
}

export interface NotFoundApiError extends ApiClientErrorBase {
  readonly kind: 'not_found';
}

export interface BadResponseApiError extends ApiClientErrorBase {
  readonly kind: 'bad_response';
  /** Present when the failure was a schema mismatch (`safeParse` issues); absent for invalid JSON. */
  readonly issues?: ZodIssue[];
}

export interface HttpApiError extends ApiClientErrorBase {
  readonly kind: 'http_error';
  readonly statusCode: number;
}

/** Discriminated union over every typed failure the HTTP client can produce. */
export type ApiClientError =
  | UnreachableApiError
  | TimeoutApiError
  | RateLimitedApiError
  | NotFoundApiError
  | BadResponseApiError
  | HttpApiError;

/**
 * Thrown by every `DevDigestApiClient` method on failure; carries the typed
 * `ApiClientError` so a caller can `catch` and narrow on `.error.kind`
 * (exhaustive `switch` in the service layer) instead of parsing a message
 * string.
 */
export class ApiClientException extends Error {
  readonly error: ApiClientError;

  constructor(error: ApiClientError) {
    super(error.message);
    this.name = 'ApiClientException';
    this.error = error;
  }
}

export function isApiClientException(err: unknown): err is ApiClientException {
  return err instanceof ApiClientException;
}
