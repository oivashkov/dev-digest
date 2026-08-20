import { describe, expect, it, vi } from 'vitest';
import { makeRunAgentOnPrTool } from './run-agent-on-pr.js';
import type { McpService } from '../service/index.js';

/** Presentation-layer test (Step 7) — result→content/`isError` mapping only. */
describe('run_agent_on_pr tool', () => {
  it('calls McpService.runAgentOnPr with the flat repo/pr/agent args and maps a completed success', async () => {
    const runAgentOnPr = vi.fn().mockResolvedValue({
      ok: true,
      data: { status: 'completed', run_id: 'run-1', verdict: 'approve', score: 95, summary: 'ok', findings: [], findings_count: 0 },
    });
    const tool = makeRunAgentOnPrTool({ runAgentOnPr } as unknown as McpService);

    const result = await tool.handler({ repo: 'acme/widgets', pr: '42', agent: 'Reviewer' });

    expect(runAgentOnPr).toHaveBeenCalledWith('acme/widgets', '42', 'Reviewer');
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({ status: 'completed' });
  });

  it('maps a run_failed ServiceFailure to isError content', async () => {
    const runAgentOnPr = vi
      .fn()
      .mockResolvedValue({ ok: false, failure: { kind: 'run_failed', message: 'Run run-1 failed: bad LLM key.' } });
    const tool = makeRunAgentOnPrTool({ runAgentOnPr } as unknown as McpService);

    const result = await tool.handler({ repo: 'acme/widgets', pr: '42', agent: 'Reviewer' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('Run run-1 failed: bad LLM key.');
  });

  it('is explicitly not read-only/idempotent, since it costs real LLM spend', () => {
    const tool = makeRunAgentOnPrTool({} as unknown as McpService);
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false, destructiveHint: false });
  });
});
