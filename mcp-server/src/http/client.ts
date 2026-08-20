import { z } from 'zod';
import {
  Agent,
  ApiErrorBody,
  ConventionsState,
  PrBlastRadius,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
  type RunRequest,
} from '@devdigest/shared';
import { ApiClientException } from './errors.js';
import type { DevDigestApiPort, HttpClientOptions } from './types.js';

/**
 * The single port to the local DevDigest Fastify API — the only `fetch`
 * site in this package (the `src/adapters/*` equivalent per
 * `backend-onion-architecture`). Constructed with a base URL + per-request
 * timeout (from `config.ts`, wired by the composition root — Step 5).
 * Called only from `src/service/**` (Step 3), never from `src/tools/*`
 * (Step 4). Every response is validated with the matching
 * `@devdigest/shared` Zod schema via `safeParse` before it is trusted —
 * this is the boundary where server JSON becomes typed data (`zod`:
 * `parse-use-safeparse`, `parse-never-trust-json`).
 *
 * Every method returns typed data or throws an `ApiClientException`
 * (`errors.ts`) — this class knows nothing about MCP `isError`; that
 * mapping is presentation's job (Step 4, via the service's result ADT).
 *
 * `fetch(this.baseUrl + path)` is safe here: the base URL comes from env
 * via `config.ts` (never attacker-controlled), and the only path segments
 * built from caller input are already-resolved ids (`security` skill:
 * "fetch(process.env.API_URL) = safe").
 */
export class DevDigestApiClient implements DevDigestApiPort {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.requestTimeoutMs = options.requestTimeoutMs;
  }

  async listAgents(): Promise<Agent[]> {
    const data = await this.get('/agents');
    return this.parse(z.array(Agent), data, '/agents');
  }

  async listRepos(): Promise<Repo[]> {
    const data = await this.get('/repos');
    return this.parse(z.array(Repo), data, '/repos');
  }

  async listPulls(repoId: string): Promise<PrMeta[]> {
    const path = `/repos/${encodeURIComponent(repoId)}/pulls`;
    const data = await this.get(path);
    return this.parse(z.array(PrMeta), data, path);
  }

  async runReview(pullId: string, body: RunRequest): Promise<ReviewRunResponse> {
    const path = `/pulls/${encodeURIComponent(pullId)}/review`;
    const data = await this.post(path, body);
    return this.parse(ReviewRunResponse, data, path);
  }

  async listReviews(pullId: string): Promise<ReviewRecord[]> {
    const path = `/pulls/${encodeURIComponent(pullId)}/reviews`;
    const data = await this.get(path);
    return this.parse(z.array(ReviewRecord), data, path);
  }

  async listRuns(pullId: string): Promise<RunSummary[]> {
    const path = `/pulls/${encodeURIComponent(pullId)}/runs`;
    const data = await this.get(path);
    return this.parse(z.array(RunSummary), data, path);
  }

  async getConventions(repoId: string): Promise<ConventionsState> {
    const path = `/repos/${encodeURIComponent(repoId)}/conventions`;
    const data = await this.get(path);
    return this.parse(ConventionsState, data, path);
  }

  async getBlastRadius(pullId: string): Promise<PrBlastRadius> {
    const path = `/pulls/${encodeURIComponent(pullId)}/blast`;
    const data = await this.get(path);
    return this.parse(PrBlastRadius, data, path);
  }

  // ---- internals -----------------------------------------------------

  private get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  private post(path: string, body: unknown): Promise<unknown> {
    return this.request('POST', path, body);
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        ...(body !== undefined
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new ApiClientException({
          kind: 'timeout',
          message: `${method} ${path} timed out after ${this.requestTimeoutMs}ms waiting for the DevDigest API`,
          timeoutMs: this.requestTimeoutMs,
        });
      }
      throw new ApiClientException({
        kind: 'unreachable',
        message: `Could not reach the DevDigest API at ${this.baseUrl} for ${method} ${path} (${describeCause(cause)})`,
        cause,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader === null ? undefined : Number(retryAfterHeader);
      throw new ApiClientException({
        kind: 'rate_limited',
        message: `Rate limited by the DevDigest API (429) on ${method} ${path}`,
        ...(retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)
          ? { retryAfterSeconds }
          : {}),
      });
    }

    if (!res.ok) {
      const unwrapped = await this.tryUnwrapErrorMessage(res);
      if (res.status === 404) {
        throw new ApiClientException({
          kind: 'not_found',
          message: unwrapped ?? `Not found: ${method} ${path}`,
        });
      }
      throw new ApiClientException({
        kind: 'http_error',
        statusCode: res.status,
        message: unwrapped ?? `DevDigest API returned ${res.status} for ${method} ${path}`,
      });
    }

    try {
      return await res.json();
    } catch {
      throw new ApiClientException({
        kind: 'bad_response',
        message: `DevDigest API returned invalid JSON for ${method} ${path}`,
      });
    }
  }

  /** Unwraps `ApiErrorBody.error.message` from a non-2xx response body, per the plan's `not_found` mapping. */
  private async tryUnwrapErrorMessage(res: Response): Promise<string | undefined> {
    try {
      const body: unknown = await res.json();
      const parsed = ApiErrorBody.safeParse(body);
      return parsed.success ? parsed.data.error.message : undefined;
    } catch {
      return undefined;
    }
  }

  // `z.ZodType<T>` alone defaults `Input = Output = T`, which breaks
  // inference for schemas whose Input and Output differ (e.g. `Agent`'s
  // `.default()` fields: optional on input, required on output) — TS then
  // can't unify a single T and silently narrows to the (still-optional)
  // Input shape, which fails assignability against the declared, fully
  // resolved return types (`Agent[]`, …) above. Decoupling Input as `any`
  // fixes generic inference to the intended Output type.
  private parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown, path: string): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new ApiClientException({
        kind: 'bad_response',
        message: `DevDigest API response for ${path} did not match the expected shape (schema drift?)`,
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}

/**
 * Best-effort human-readable description of a `fetch()` rejection's cause
 * (e.g. ECONNREFUSED). Node's `fetch` (undici) throws `TypeError: fetch
 * failed` with the actual system error (which carries `.code`) one level
 * down on `.cause` — so this walks one `.cause` link, not just the
 * top-level error, or `ECONNREFUSED` would never surface.
 */
function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const inner = cause.cause;
  const code =
    (inner as NodeJS.ErrnoException | undefined)?.code ?? (cause as NodeJS.ErrnoException).code;
  const message = inner instanceof Error ? inner.message : cause.message;
  return code ? `${message} [${code}]` : message;
}
