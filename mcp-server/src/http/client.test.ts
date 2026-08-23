import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevDigestApiClient } from './client.js';
import { isApiClientException } from './errors.js';
import { makeAgent, makeRunSummary } from '../../test/helpers/fixtures.js';

/**
 * Infrastructure-layer tests (Step 7 of `specs/mcp-server-plan.md`) for the
 * only `fetch` site in this package. Asserts schema validation (via
 * `@devdigest/shared`) against a mocked `fetch`, and the six-kind typed-error
 * taxonomy from `errors.ts`. Presentation/service concerns (next-step
 * messages, MCP mapping) are NOT this layer's job — see `service/results.ts`
 * and `tools/*.test.ts`.
 */

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe('DevDigestApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeClient(requestTimeoutMs = 5_000): DevDigestApiClient {
    return new DevDigestApiClient({ baseUrl: 'http://localhost:3001', requestTimeoutMs });
  }

  it('parses a valid /agents response into typed Agent[]', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [makeAgent({ id: 'a1', name: 'Reviewer' })]));

    const agents = await makeClient().listAgents();

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: 'a1', name: 'Reviewer', strategy: 'single-pass' });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/agents', expect.objectContaining({ method: 'GET' }));
  });

  it('parses a valid /pulls/:id/runs response into typed RunSummary[] (listRuns addendum)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [makeRunSummary({ run_id: 'run-9', status: 'failed' })]));

    const runs = await makeClient().listRuns('pull-1');

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ run_id: 'run-9', status: 'failed' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/pulls/pull-1/runs',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('maps a schema mismatch to a bad_response error (schema drift)', async () => {
    // Missing every required Agent field.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [{ id: 'a1' }]));

    await expect(makeClient().listAgents()).rejects.toMatchObject({ error: { kind: 'bad_response' } });
  });

  it('maps invalid JSON in an otherwise-ok response to a bad_response error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Response);

    await expect(makeClient().listAgents()).rejects.toMatchObject({ error: { kind: 'bad_response' } });
  });

  it('maps a connection failure (ECONNREFUSED) to an unreachable error', async () => {
    const inner = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3001'), { code: 'ECONNREFUSED' });
    const fetchFailed = Object.assign(new TypeError('fetch failed'), { cause: inner });
    fetchMock.mockRejectedValueOnce(fetchFailed);

    const err = await makeClient().listAgents().catch((e: unknown) => e);

    expect(isApiClientException(err)).toBe(true);
    if (isApiClientException(err)) {
      expect(err.error.kind).toBe('unreachable');
      expect(err.error.message).toContain('localhost:3001');
    }
  });

  it('maps an aborted request (per-request timeout) to a timeout error', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );

    const err = await makeClient(10).listAgents().catch((e: unknown) => e);

    expect(isApiClientException(err)).toBe(true);
    if (isApiClientException(err)) {
      expect(err.error.kind).toBe('timeout');
      if (err.error.kind === 'timeout') expect(err.error.timeoutMs).toBe(10);
    }
  });

  it('maps a 429 response to a rate_limited error, carrying Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '30' }));

    const err = await makeClient().listAgents().catch((e: unknown) => e);

    expect(isApiClientException(err)).toBe(true);
    if (isApiClientException(err)) {
      expect(err.error.kind).toBe('rate_limited');
      if (err.error.kind === 'rate_limited') expect(err.error.retryAfterSeconds).toBe(30);
    }
  });

  it('maps a 404 response to a not_found error, unwrapping ApiErrorBody.error.message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: { code: 'not_found', message: 'Repo not found' } }),
    );

    await expect(makeClient().listAgents()).rejects.toMatchObject({
      error: { kind: 'not_found', message: 'Repo not found' },
    });
  });

  it('maps any other non-2xx response to an http_error, carrying the status code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { code: 'internal', message: 'boom' } }));

    await expect(makeClient().listAgents()).rejects.toMatchObject({
      error: { kind: 'http_error', statusCode: 500, message: 'boom' },
    });
  });
});
