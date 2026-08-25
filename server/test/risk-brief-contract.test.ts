import { describe, it, expect } from 'vitest';
import { RiskBriefExtraction, PrRiskBrief } from '@devdigest/shared';

/**
 * Contract test for the new PR Why + Risk Brief shared types — round-trips
 * `PrRiskBrief.parse()` on a full fixture and asserts `risk_level` is a
 * server-only field the LLM-facing `RiskBriefExtraction` schema never
 * requires (AC15: `risk_level` is never in the LLM schema).
 * Precedent: `server/test/blast-contract.test.ts`.
 */
describe('RiskBriefExtraction / PrRiskBrief contract', () => {
  const extractionFixture = {
    what: 'Adds a rate limiter to the public items endpoint.',
    why: 'Prevent abuse of GET /api/public/items reported in ticket ABC-123.',
    risks: [
      {
        kind: 'reliability',
        title: 'Rate limiter has no bypass for internal callers',
        explanation: 'Internal batch jobs hit the same endpoint and may get throttled.',
        severity: 'medium',
        file_refs: ['src/middleware/rate-limit.ts'],
      },
    ],
    review_focus: [
      {
        file: 'src/middleware/rate-limit.ts',
        line: 23,
        reason: 'New limiter logic — verify the bucket key.',
      },
      {
        file: 'src/routes/public.ts',
        endpoint: 'GET /api/public/items',
        reason: 'Endpoint now behind the new limiter.',
      },
    ],
  };

  it('RiskBriefExtraction parses the raw LLM shape without a risk_level field', () => {
    const parsed = RiskBriefExtraction.parse(extractionFixture);
    expect(parsed.what).toBe(extractionFixture.what);
    expect(parsed.risks).toHaveLength(1);
    expect(parsed.review_focus).toHaveLength(2);
    // The extraction schema never declares risk_level — parsing an object
    // without it must succeed, and the parsed result must not carry one in.
    expect((parsed as Record<string, unknown>).risk_level).toBeUndefined();
  });

  it('PrRiskBrief requires risk_level — an extraction-only payload is rejected', () => {
    expect(() => PrRiskBrief.parse(extractionFixture)).toThrow();
  });

  it('PrRiskBrief round-trips the persisted/transport shape, including head_sha', () => {
    const briefFixture = {
      ...extractionFixture,
      pr_id: 'pr-1',
      risk_level: 'medium',
      head_sha: 'abc123def456',
    };

    const parsed = PrRiskBrief.parse(briefFixture);
    expect(parsed.pr_id).toBe('pr-1');
    expect(parsed.risk_level).toBe('medium');
    expect(parsed.head_sha).toBe('abc123def456');
    expect(parsed.risks).toHaveLength(1);
    expect(parsed.review_focus[1]!.endpoint).toBe('GET /api/public/items');
  });

  it('rejects an unknown risk_level value', () => {
    expect(() =>
      PrRiskBrief.parse({
        ...extractionFixture,
        pr_id: 'pr-2',
        risk_level: 'critical',
        head_sha: 'abc123',
      }),
    ).toThrow();
  });
});
