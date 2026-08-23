import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpService } from './index.js';
import { createMockApiClient } from '../../test/helpers/mock-api-client.js';
import {
  makeAgent,
  makeConventionCandidate,
  makeConventionsState,
  makeFindingRecord,
  makePr,
  makeRepo,
  makeReviewRecord,
  makeRunSummary,
} from '../../test/helpers/fixtures.js';
import { ApiClientException } from '../http/errors.js';

/**
 * Application/service-layer tests (Step 7 of `specs/mcp-server-plan.md`) —
 * the bulk of the suite, per the plan. Covers every shaping/pagination path
 * and `runAgentOnPr`'s four documented timing branches (synchronous
 * completion, slow-POST-then-poll-success, poll-exhausted-timeout, and
 * `run_failed` detection via `listRuns`, the addendum after Step 3) using
 * `vi.useFakeTimers()` to control the poll loop deterministically instead of
 * real sleeps.
 */

const repo = makeRepo();
const pr = makePr();
const agent = makeAgent();

function baseClientOverrides() {
  return {
    listRepos: vi.fn().mockResolvedValue([repo]),
    listPulls: vi.fn().mockResolvedValue([pr]),
    listAgents: vi.fn().mockResolvedValue([agent]),
  };
}

describe('McpService.listAgents', () => {
  it('trims agent fields', async () => {
    const client = createMockApiClient({
      listAgents: vi.fn().mockResolvedValue([makeAgent({ id: 'a1', name: 'Reviewer' })]),
    });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.listAgents();

    expect(result).toEqual({
      ok: true,
      data: { agents: [{ id: 'a1', name: 'Reviewer', model: 'gpt-4o', enabled: true, strategy: 'single-pass' }] },
    });
  });

  it('propagates an unreachable API failure as a typed ServiceFailure', async () => {
    const client = createMockApiClient({
      listAgents: vi.fn().mockRejectedValue(new ApiClientException({ kind: 'unreachable', message: 'x', cause: undefined })),
    });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.listAgents();

    expect(result).toMatchObject({ ok: false, failure: { kind: 'unreachable' } });
  });
});

describe('McpService.getConventions', () => {
  it('resolves the repo, then trims + paginates conventions', async () => {
    const candidates = [makeConventionCandidate({ id: 'c1' }), makeConventionCandidate({ id: 'c2' })];
    const client = createMockApiClient({
      ...baseClientOverrides(),
      getConventions: vi.fn().mockResolvedValue(makeConventionsState({ candidates, scan_status: 'idle' })),
    });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getConventions(repo.full_name);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.conventions).toHaveLength(2);
      expect(result.data.conventions[0]).toMatchObject({ evidence: 'src/foo.ts:12-31' });
      expect(result.data.total).toBe(2);
      expect(result.data.message).toBeUndefined();
    }
  });

  it('surfaces a not-yet-scanned message when idle with zero candidates', async () => {
    const client = createMockApiClient({
      ...baseClientOverrides(),
      getConventions: vi.fn().mockResolvedValue(makeConventionsState({ candidates: [], scan_status: 'idle' })),
    });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getConventions(repo.full_name);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.message).toContain('not been scanned for conventions yet');
  });

  it('paginates conventions by the requested page', async () => {
    const candidates = Array.from({ length: 25 }, (_, i) => makeConventionCandidate({ id: `c${i}`, rule: `rule ${i}` }));
    const client = createMockApiClient({
      ...baseClientOverrides(),
      getConventions: vi.fn().mockResolvedValue(makeConventionsState({ candidates })),
    });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getConventions(repo.full_name, 2);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.page).toBe(2);
      expect(result.data.total).toBe(25);
      expect(result.data.conventions).toHaveLength(5); // default page size 20 -> page 2 has 5 left
      expect(result.data.conventions[0]?.rule).toBe('rule 20');
    }
  });

  it('fails resolution when the repo cannot be found', async () => {
    const client = createMockApiClient({ listRepos: vi.fn().mockResolvedValue([]) });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getConventions('ghost/repo');

    expect(result).toMatchObject({ ok: false, failure: { kind: 'repo_not_found' } });
    expect(client.getConventions).not.toHaveBeenCalled();
  });
});

describe('McpService.getFindings', () => {
  it('returns the most recent review when no run_id is given', async () => {
    const older = makeReviewRecord({ run_id: 'run-old', kind: 'review', created_at: '2026-01-01T00:00:00.000Z' });
    const newer = makeReviewRecord({
      run_id: 'run-new',
      kind: 'review',
      created_at: '2026-02-01T00:00:00.000Z',
      findings: [makeFindingRecord({ id: 'f1' })],
    });
    const client = createMockApiClient({
      ...baseClientOverrides(),
      listReviews: vi.fn().mockResolvedValue([older, newer]),
    });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getFindings(repo.full_name, pr.number);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.run_id).toBe('run-new');
      expect(result.data.findings).toHaveLength(1);
    }
  });

  it('ignores non-review rows (kind: summary) when picking the most recent review', async () => {
    const summary = makeReviewRecord({ run_id: 'run-summary', kind: 'summary', created_at: '2026-03-01T00:00:00.000Z' });
    const review = makeReviewRecord({ run_id: 'run-review', kind: 'review', created_at: '2026-01-01T00:00:00.000Z' });
    const client = createMockApiClient({
      ...baseClientOverrides(),
      listReviews: vi.fn().mockResolvedValue([summary, review]),
    });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getFindings(repo.full_name, pr.number);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.run_id).toBe('run-review');
  });

  it('returns a specific run via run_id even when it is not the most recent', async () => {
    const older = makeReviewRecord({ run_id: 'run-old', kind: 'review', created_at: '2026-01-01T00:00:00.000Z' });
    const newer = makeReviewRecord({ run_id: 'run-new', kind: 'review', created_at: '2026-02-01T00:00:00.000Z' });
    const client = createMockApiClient({
      ...baseClientOverrides(),
      listReviews: vi.fn().mockResolvedValue([older, newer]),
    });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getFindings(repo.full_name, pr.number, 'run-old');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.run_id).toBe('run-old');
  });

  it('fails with no_reviews_yet when the PR has zero completed reviews', async () => {
    const client = createMockApiClient({ ...baseClientOverrides(), listReviews: vi.fn().mockResolvedValue([]) });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getFindings(repo.full_name, pr.number);

    expect(result).toMatchObject({ ok: false, failure: { kind: 'no_reviews_yet' } });
    if (!result.ok) expect(result.failure.message).toContain('run_agent_on_pr');
  });

  it('fails with run_not_found when the given run_id matches no review on this PR', async () => {
    const review = makeReviewRecord({ run_id: 'run-real', kind: 'review' });
    const client = createMockApiClient({ ...baseClientOverrides(), listReviews: vi.fn().mockResolvedValue([review]) });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getFindings(repo.full_name, pr.number, 'run-missing');

    expect(result).toMatchObject({ ok: false, failure: { kind: 'run_not_found' } });
    if (!result.ok) expect(result.failure.message).toContain('run_id run-missing');
  });

  it('fails with bad_response when the matched review is missing its run_id', async () => {
    const review = makeReviewRecord({ run_id: null, kind: 'review' });
    const client = createMockApiClient({ ...baseClientOverrides(), listReviews: vi.fn().mockResolvedValue([review]) });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getFindings(repo.full_name, pr.number);

    expect(result).toMatchObject({ ok: false, failure: { kind: 'bad_response' } });
  });

  it('paginates findings by the requested page/page_size', async () => {
    const findings = Array.from({ length: 15 }, (_, i) => makeFindingRecord({ id: `f${i}`, title: `finding ${i}` }));
    const review = makeReviewRecord({ run_id: 'run-1', kind: 'review', findings });
    const client = createMockApiClient({ ...baseClientOverrides(), listReviews: vi.fn().mockResolvedValue([review]) });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getFindings(repo.full_name, pr.number, undefined, 2, 5);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.page).toBe(2);
      expect(result.data.page_size).toBe(5);
      expect(result.data.total).toBe(15);
      expect(result.data.findings.map((f) => f.title)).toEqual(['finding 5', 'finding 6', 'finding 7', 'finding 8', 'finding 9']);
    }
  });
});

describe('McpService.getBlastRadius', () => {
  const blastRadius = {
    pr_id: pr.id,
    repo_id: repo.id,
    symbols: [
      {
        name: 'handleRequest',
        file: 'src/foo.ts',
        kind: 'function',
        callers: [{ file: 'src/bar.ts', symbol: 'callFoo', line: 12, rank: 3 }],
        endpoints: ['GET /api/public/items'],
        crons: [],
        callers_truncated: false,
      },
      {
        name: 'scheduleReset',
        file: 'src/reset.ts',
        kind: 'function',
        callers: [{ file: 'src/cron-runner.ts', symbol: 'runScheduled', line: 5, rank: 1 }],
        endpoints: [],
        crons: ['reset-rate-buckets (hourly)'],
        callers_truncated: false,
      },
    ],
    impacted_endpoints: ['GET /api/public/items'],
    impacted_crons: ['reset-rate-buckets (hourly)'],
    counts: { symbols: 2, callers: 2, endpoints: 1, crons: 1 },
    status: 'full' as const,
    reason: null,
  };

  it('resolves repo+pr, then returns the blast radius from the API', async () => {
    const getBlastRadius = vi.fn().mockResolvedValue(blastRadius);
    const client = createMockApiClient({ ...baseClientOverrides(), getBlastRadius });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getBlastRadius(repo.full_name, pr.number);

    expect(result).toEqual({ ok: true, data: blastRadius });
    expect(getBlastRadius).toHaveBeenCalledWith(pr.id);
  });

  it('fails with invalid_input and a next-step message when pr is not provided, with no HTTP call', async () => {
    const client = createMockApiClient();
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getBlastRadius(repo.full_name);

    expect(result).toMatchObject({ ok: false, failure: { kind: 'invalid_input' } });
    if (!result.ok) expect(result.failure.message).toContain('pass pr=<number>');
    expect(client.listRepos).not.toHaveBeenCalled();
    expect(client.listPulls).not.toHaveBeenCalled();
  });

  it('fails with repo_not_found when the repo cannot be found (existing resolveRepo path)', async () => {
    const client = createMockApiClient({ listRepos: vi.fn().mockResolvedValue([]) });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getBlastRadius('ghost/repo', pr.number);

    expect(result).toMatchObject({ ok: false, failure: { kind: 'repo_not_found' } });
  });

  it('narrows symbols/impacted endpoints+crons/counts to the given file', async () => {
    const getBlastRadius = vi.fn().mockResolvedValue(blastRadius);
    const client = createMockApiClient({ ...baseClientOverrides(), getBlastRadius });
    const service = new McpService(client, { pollIntervalMs: 10, hardTimeoutMs: 100 });

    const result = await service.getBlastRadius(repo.full_name, pr.number, 'src/foo.ts');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.symbols).toHaveLength(1);
      expect(result.data.symbols[0]?.file).toBe('src/foo.ts');
      expect(result.data.impacted_endpoints).toEqual(['GET /api/public/items']);
      expect(result.data.impacted_crons).toEqual([]);
      expect(result.data.counts).toEqual({ symbols: 1, callers: 1, endpoints: 1, crons: 0 });
      // status/reason pass through unchanged — file narrows scope, not index completeness.
      expect(result.data.status).toBe('full');
    }
  });
});

describe('McpService.runAgentOnPr', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeService(client: ReturnType<typeof createMockApiClient>, hardTimeoutMs = 10_000, pollIntervalMs = 2_000) {
    return new McpService(client, { pollIntervalMs, hardTimeoutMs });
  }

  it('completes synchronously when the POST response already carries the matching review', async () => {
    const client = createMockApiClient({
      ...baseClientOverrides(),
      runReview: vi.fn().mockResolvedValue({
        pr_id: pr.id,
        runs: [{ run_id: 'run-1', agent_id: agent.id, agent_name: agent.name }],
        reviews: [makeReviewRecord({ run_id: 'run-1', kind: 'review', findings: [makeFindingRecord()] })],
      }),
    });
    const service = makeService(client);

    const result = await service.runAgentOnPr(repo.full_name, pr.number, agent.name);

    expect(result).toMatchObject({ ok: true, data: { status: 'completed', run_id: 'run-1', findings_count: 1 } });
    expect(client.listRuns).not.toHaveBeenCalled();
    expect(client.listReviews).not.toHaveBeenCalled();
  });

  it('polls until the review completes when the POST response has no immediate review', async () => {
    const client = createMockApiClient({
      ...baseClientOverrides(),
      runReview: vi.fn().mockResolvedValue({
        pr_id: pr.id,
        runs: [{ run_id: 'run-2', agent_id: agent.id, agent_name: agent.name }],
        reviews: [],
      }),
      listRuns: vi
        .fn()
        .mockResolvedValueOnce([makeRunSummary({ run_id: 'run-2', status: 'running' })])
        .mockResolvedValueOnce([makeRunSummary({ run_id: 'run-2', status: 'done' })]),
      listReviews: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeReviewRecord({ run_id: 'run-2', kind: 'review', findings: [makeFindingRecord()] })]),
    });
    const service = makeService(client);

    const resultPromise = service.runAgentOnPr(repo.full_name, pr.number, agent.name);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result).toMatchObject({ ok: true, data: { status: 'completed', run_id: 'run-2', findings_count: 1 } });
    expect(client.listRuns).toHaveBeenCalledTimes(2);
  });

  it('returns a timeout-fallback result once the poll budget is exhausted', async () => {
    const client = createMockApiClient({
      ...baseClientOverrides(),
      runReview: vi.fn().mockResolvedValue({
        pr_id: pr.id,
        runs: [{ run_id: 'run-3', agent_id: agent.id, agent_name: agent.name }],
        reviews: [],
      }),
      listRuns: vi.fn().mockResolvedValue([makeRunSummary({ run_id: 'run-3', status: 'running' })]),
      listReviews: vi.fn().mockResolvedValue([]),
    });
    const service = makeService(client, 5_000, 2_000);

    const resultPromise = service.runAgentOnPr(repo.full_name, pr.number, agent.name);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result).toMatchObject({ ok: true, data: { status: 'timeout', run_id: 'run-3' } });
    if (result.ok && result.data.status === 'timeout') {
      expect(result.data.message).toContain('get_findings');
    }
  });

  it('detects a server-side run failure via listRuns and returns run_failed immediately (addendum)', async () => {
    const client = createMockApiClient({
      ...baseClientOverrides(),
      runReview: vi.fn().mockResolvedValue({
        pr_id: pr.id,
        runs: [{ run_id: 'run-4', agent_id: agent.id, agent_name: agent.name }],
        reviews: [],
      }),
      listRuns: vi.fn().mockResolvedValue([makeRunSummary({ run_id: 'run-4', status: 'failed', error: 'bad LLM key' })]),
      listReviews: vi.fn().mockResolvedValue([]),
    });
    const service = makeService(client, 60_000, 2_000);

    const resultPromise = service.runAgentOnPr(repo.full_name, pr.number, agent.name);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result).toMatchObject({ ok: false, failure: { kind: 'run_failed' } });
    if (!result.ok) {
      expect(result.failure.message).toContain('run-4');
      expect(result.failure.message).toContain('bad LLM key');
    }
    // Failure is reported on the very first poll iteration, not after exhausting the budget.
    expect(client.listRuns).toHaveBeenCalledTimes(1);
  });
});
