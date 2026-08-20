import { describe, expect, it, vi } from 'vitest';
import { makeGetFindingsTool } from './get-findings.js';
import type { McpService } from '../service/index.js';

/** Presentation-layer test (Step 7) — result→content/`isError` mapping only. */
describe('get_findings tool', () => {
  it('calls McpService.getFindings with all flat args and maps success', async () => {
    const getFindings = vi.fn().mockResolvedValue({
      ok: true,
      data: { run_id: 'run-1', verdict: 'comment', score: 80, summary: 'ok', findings: [], page: 1, page_size: 20, total: 0 },
    });
    const tool = makeGetFindingsTool({ getFindings } as unknown as McpService);

    const result = await tool.handler({ repo: 'acme/widgets', pr: '42', run_id: 'run-1', page: 1, page_size: 20 });

    expect(getFindings).toHaveBeenCalledWith('acme/widgets', '42', 'run-1', 1, 20);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({ run_id: 'run-1' });
  });

  it('surfaces a no_reviews_yet failure as isError, never a silent empty findings array', async () => {
    const getFindings = vi.fn().mockResolvedValue({
      ok: false,
      failure: { kind: 'no_reviews_yet', message: 'No completed review found for this PR yet — call run_agent_on_pr to start one.' },
    });
    const tool = makeGetFindingsTool({ getFindings } as unknown as McpService);

    const result = await tool.handler({ repo: 'acme/widgets', pr: '42', run_id: undefined, page: undefined, page_size: undefined });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('call run_agent_on_pr to start one');
  });
});
