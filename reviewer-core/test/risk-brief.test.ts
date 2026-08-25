/**
 * extractRiskBrief — sends title/description/intent/blast-summary/diff-stat/
 * ticket/plan-excerpt signals (each untrusted-wrapped) to the injected
 * LLMProvider using the RiskBriefExtraction schema (no risk_level field), and
 * returns the parsed extraction untouched.
 *
 * groundRiskBrief — the mechanical gate over that extraction's risks[]/
 * review_focus[] file/endpoint citations.
 */
import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../../server/src/adapters/mocks.js';
import { extractRiskBrief, buildRiskBriefMessages, groundRiskBrief } from '../src/index.js';

describe('extractRiskBrief', () => {
  const fixture = {
    what: 'Adds rate limiting to the public /api endpoints.',
    why: 'Users were hammering /api/search and abuse reports came in.',
    risks: [
      {
        kind: 'reliability',
        title: 'New limiter could reject legitimate bursts',
        explanation: 'The token bucket size is fixed and untested under load.',
        severity: 'medium',
        file_refs: ['src/middleware/rate-limit.ts'],
      },
    ],
    review_focus: [
      {
        file: 'src/middleware/rate-limit.ts',
        reason: 'Core limiter logic — check the bucket refill math.',
      },
    ],
  };

  it('calls completeStructured exactly once with the given model + RiskBriefExtraction schema, returns the extraction', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { RiskBriefExtraction: fixture },
    });

    const outcome = await extractRiskBrief({
      llm,
      model: 'gpt-4.1',
      title: 'Add rate limiting',
      description: 'Adds a token-bucket limiter to public endpoints.',
      intent: 'Prevent abuse of public API endpoints.',
      blastSummary: 'Affects endpoints: POST /api/search.',
      diffStat: 'src/middleware/rate-limit.ts | 40 ++++',
      ticket: { title: 'RATE-42: abuse reports', body: 'Users are hammering /api/search.' },
      planExcerpts: [{ path: 'docs/plans/rate-limit.md', content: 'Plan: add limiter.' }],
    });

    expect(outcome.extraction).toEqual(fixture);
    expect(outcome.tokensIn).toBeGreaterThanOrEqual(0);

    expect(llm.calls).toHaveLength(1);
    const call = llm.calls[0]!;
    expect(call.method).toBe('completeStructured');
    const req = call.req as {
      model: string;
      schemaName: string;
      messages: { role: string; content: string }[];
    };
    expect(req.model).toBe('gpt-4.1');
    expect(req.schemaName).toBe('RiskBriefExtraction');

    const user = req.messages[1]!.content;
    expect(user).toContain('## PR title');
    expect(user).toContain('<untrusted source="pr-title">');
    expect(user).toContain('Add rate limiting');
    expect(user).toContain('## PR description');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('## Derived intent/scope');
    expect(user).toContain('<untrusted source="pr-intent">');
    expect(user).toContain('## Blast radius summary');
    expect(user).toContain('<untrusted source="blast-summary">');
    expect(user).toContain('## Diff stat (changed files only, no hunk bodies)');
    expect(user).toContain('<untrusted source="diff-stat">');
    expect(user).toContain('## Linked ticket');
    expect(user).toContain('<untrusted source="linked-ticket">');
    expect(user).toContain('RATE-42');
    expect(user).toContain('## Referenced plan/spec excerpts');
    expect(user).toContain('docs/plans/rate-limit.md');

    const system = req.messages[0]!.content;
    expect(system).toContain('Do NOT');
    expect(system).toMatch(/risk_level/i);
    expect(system).toMatch(/mechanically checked/i);
  });

  it('omits optional sections when only title is provided', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { RiskBriefExtraction: fixture },
    });

    await extractRiskBrief({ llm, model: 'gpt-4.1', title: 'Fix typo' });

    expect(llm.calls).toHaveLength(1);
    const req = llm.calls[0]!.req as { messages: { role: string; content: string }[] };
    const user = req.messages[1]!.content;
    expect(user).toContain('## PR title');
    expect(user).not.toContain('## PR description');
    expect(user).not.toContain('## Derived intent/scope');
    expect(user).not.toContain('## Blast radius summary');
    expect(user).not.toContain('## Diff stat');
    expect(user).not.toContain('## Linked ticket');
    expect(user).not.toContain('## Referenced plan/spec excerpts');
  });

  it('anti-drift: buildRiskBriefMessages(input) deep-equals what extractRiskBrief actually sends', async () => {
    const promptInput = {
      title: 'Add rate limiting',
      description: 'Adds a token-bucket limiter to public endpoints.',
      intent: 'Prevent abuse of public API endpoints.',
      blastSummary: 'Affects endpoints: POST /api/search.',
      diffStat: 'src/middleware/rate-limit.ts | 40 ++++',
      ticket: { title: 'RATE-42: abuse reports', body: 'Users are hammering /api/search.' },
      planExcerpts: [{ path: 'docs/plans/rate-limit.md', content: 'Plan: add limiter.' }],
    };

    const expectedMessages = buildRiskBriefMessages(promptInput);

    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { RiskBriefExtraction: fixture },
    });

    await extractRiskBrief({ llm, model: 'gpt-4.1', ...promptInput });

    expect(llm.calls).toHaveLength(1);
    const req = llm.calls[0]!.req as { messages: unknown };
    expect(req.messages).toEqual(expectedMessages);
  });
});

describe('groundRiskBrief', () => {
  const allowlist = {
    files: new Set(['src/middleware/rate-limit.ts', 'src/routes/search.ts']),
    endpoints: new Set(['POST /api/search']),
  };

  it('keeps risks/review_focus items that cite only allowlisted files/endpoints', () => {
    const extraction = {
      what: 'x',
      why: 'y',
      risks: [
        {
          kind: 'reliability',
          title: 'ok',
          explanation: 'ok',
          severity: 'high' as const,
          file_refs: ['src/middleware/rate-limit.ts'],
        },
      ],
      review_focus: [
        {
          file: 'src/routes/search.ts',
          endpoint: 'POST /api/search',
          reason: 'Endpoint entry point.',
        },
      ],
    };

    const result = groundRiskBrief(extraction, allowlist);
    expect(result.risks).toHaveLength(1);
    expect(result.review_focus).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it('drops a risk citing a non-existent file, and a focus item citing an unknown endpoint', () => {
    const extraction = {
      what: 'x',
      why: 'y',
      risks: [
        {
          kind: 'reliability',
          title: 'bad',
          explanation: 'cites a file not in this PR',
          severity: 'high' as const,
          file_refs: ['src/does/not/exist.ts'],
        },
      ],
      review_focus: [
        {
          file: 'src/middleware/rate-limit.ts',
          endpoint: 'DELETE /api/nonexistent',
          reason: 'cites an endpoint not affected by this PR',
        },
      ],
    };

    const result = groundRiskBrief(extraction, allowlist);
    expect(result.risks).toHaveLength(0);
    expect(result.review_focus).toHaveLength(0);
    expect(result.dropped).toHaveLength(2);
    expect(result.dropped[0]!.reason).toMatch(/not a changed file/);
    expect(result.dropped[1]!.reason).toMatch(/not an impacted endpoint/);
  });

  it('returns { risks: [], review_focus: [] } (not a throw) when everything fails', () => {
    const extraction = {
      what: 'x',
      why: 'y',
      risks: [
        {
          kind: 'reliability',
          title: 'bad',
          explanation: 'bad',
          severity: 'low' as const,
          file_refs: ['nope.ts'],
        },
      ],
      review_focus: [{ file: 'nope.ts', reason: 'bad' }],
    };

    const result = groundRiskBrief(extraction, { files: [], endpoints: [] });
    expect(result).toMatchObject({ risks: [], review_focus: [] });
    expect(result.dropped).toHaveLength(2);
  });

  it('a review_focus item without an endpoint is kept purely on the file check', () => {
    const extraction = {
      what: 'x',
      why: 'y',
      risks: [],
      review_focus: [{ file: 'src/middleware/rate-limit.ts', reason: 'no endpoint cited' }],
    };

    const result = groundRiskBrief(extraction, allowlist);
    expect(result.review_focus).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });
});
