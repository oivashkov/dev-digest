/**
 * classifyIntent — sends title/description/ticket/plan-excerpt/diff-stat
 * signals (each untrusted-wrapped) to the injected LLMProvider using the
 * IntentExtraction schema (no confidence field), and returns the parsed
 * extraction untouched.
 */
import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../../server/src/adapters/mocks.js';
import { classifyIntent } from '../src/index.js';

describe('classifyIntent', () => {
  const fixture = {
    intent: 'Add rate limiting to the public /api endpoints to prevent abuse.',
    in_scope: ['rate limiting middleware', 'public API routes'],
    out_of_scope: ['authentication changes'],
  };

  it('calls completeStructured with the given model + IntentExtraction schema, returns the extraction', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { IntentExtraction: fixture },
    });

    const outcome = await classifyIntent({
      llm,
      model: 'deepseek/deepseek-v4-flash',
      title: 'Add rate limiting',
      description: 'Adds a token-bucket limiter to public endpoints.',
      ticket: { title: 'RATE-42: abuse reports', body: 'Users are hammering /api/search.' },
      planExcerpts: [{ path: 'docs/plans/rate-limit.md', content: 'Plan: add limiter.' }],
      diffStat: 'src/middleware/rate-limit.ts | 40 ++++',
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
    expect(req.model).toBe('deepseek/deepseek-v4-flash');
    expect(req.schemaName).toBe('IntentExtraction');

    const user = req.messages[1]!.content;
    expect(user).toContain('## PR title');
    expect(user).toContain('<untrusted source="pr-title">');
    expect(user).toContain('Add rate limiting');
    expect(user).toContain('## PR description');
    expect(user).toContain('## Linked ticket');
    expect(user).toContain('RATE-42');
    expect(user).toContain('## Referenced plan/spec excerpts');
    expect(user).toContain('docs/plans/rate-limit.md');
    expect(user).toContain('## Diff stat (fallback signal)');

    const system = req.messages[0]!.content;
    expect(system).toContain('Do NOT');
    expect(system).toMatch(/confidence/i);
  });

  it('omits optional sections when only title is provided (diff-stat-only fallback path)', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { IntentExtraction: fixture },
    });

    await classifyIntent({ llm, model: 'gpt-4.1', title: 'Fix typo' });

    const req = llm.calls[0]!.req as { messages: { role: string; content: string }[] };
    const user = req.messages[1]!.content;
    expect(user).toContain('## PR title');
    expect(user).not.toContain('## PR description');
    expect(user).not.toContain('## Linked ticket');
    expect(user).not.toContain('## Referenced plan/spec excerpts');
    expect(user).not.toContain('## Diff stat');
  });
});
