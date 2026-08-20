import { describe, it, expect } from 'vitest';
import { PrBlastRadius } from '@devdigest/shared';

/**
 * Contract test for the new Blast Radius shared type — round-trips
 * `PrBlastRadius.parse()` on full / partial / degraded fixtures.
 * Precedent: `server/test/contracts.test.ts:68-80`.
 */
describe('PrBlastRadius contract', () => {
  it('parses a full-status fixture with symbols, callers, endpoints and crons', () => {
    const fixture = {
      pr_id: 'pr-1',
      repo_id: 'repo-1',
      symbols: [
        {
          name: 'rateLimit',
          file: 'src/middleware/rate-limit.ts',
          kind: 'function',
          callers: [
            { file: 'src/routes/public.ts', symbol: 'publicRouter', line: 23, rank: 5 },
          ],
          endpoints: ['GET /api/public/items'],
          crons: ['reset-rate-buckets (hourly)'],
          callers_truncated: false,
        },
      ],
      impacted_endpoints: ['GET /api/public/items'],
      impacted_crons: ['reset-rate-buckets (hourly)'],
      counts: { symbols: 1, callers: 1, endpoints: 1, crons: 1 },
      status: 'full',
    };

    const parsed = PrBlastRadius.parse(fixture);
    expect(parsed.status).toBe('full');
    expect(parsed.reason).toBeUndefined();
    expect(parsed.symbols[0]!.callers_truncated).toBe(false);
  });

  it('parses a partial-status fixture with a truncated reason', () => {
    const fixture = {
      pr_id: 'pr-2',
      repo_id: 'repo-2',
      symbols: [
        {
          name: 'processOrder',
          file: 'src/orders/service.ts',
          kind: 'function',
          callers: [],
          endpoints: [],
          crons: [],
          callers_truncated: true,
        },
      ],
      impacted_endpoints: [],
      impacted_crons: [],
      counts: { symbols: 1, callers: 0, endpoints: 0, crons: 0 },
      status: 'partial',
      reason: 'truncated',
    };

    const parsed = PrBlastRadius.parse(fixture);
    expect(parsed.status).toBe('partial');
    expect(parsed.reason).toBe('truncated');
  });

  it('parses a degraded-status fixture with no downstream data', () => {
    const fixture = {
      pr_id: 'pr-3',
      repo_id: 'repo-3',
      symbols: [],
      impacted_endpoints: [],
      impacted_crons: [],
      counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      status: 'degraded',
      reason: 'no_data',
    };

    const parsed = PrBlastRadius.parse(fixture);
    expect(parsed.status).toBe('degraded');
    expect(parsed.reason).toBe('no_data');
    expect(parsed.symbols).toHaveLength(0);
  });

  it('rejects an unknown status value', () => {
    expect(() =>
      PrBlastRadius.parse({
        pr_id: 'pr-4',
        repo_id: 'repo-4',
        symbols: [],
        impacted_endpoints: [],
        impacted_crons: [],
        counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
        status: 'unknown',
      }),
    ).toThrow();
  });
});
