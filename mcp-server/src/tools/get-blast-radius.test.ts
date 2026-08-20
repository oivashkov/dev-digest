import { describe, expect, it, vi } from 'vitest';
import { makeGetBlastRadiusTool } from './get-blast-radius.js';
import type { McpService } from '../service/index.js';

/**
 * Presentation-layer test (Step 7) — result→content/`isError` mapping and
 * argument pass-through only. Real resolution/filtering behavior lives in
 * `src/service/index.test.ts` (`McpService.getBlastRadius`).
 */
describe('get_blast_radius tool', () => {
  const blastRadius = {
    pr_id: 'pr-1',
    repo_id: 'repo-1',
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
    ],
    impacted_endpoints: ['GET /api/public/items'],
    impacted_crons: [],
    counts: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
    status: 'full',
    reason: null,
  };

  it('maps a successful blast radius to non-error JSON content, passing repo/pr/file through', async () => {
    const getBlastRadius = vi.fn().mockResolvedValue({ ok: true, data: blastRadius });
    const tool = makeGetBlastRadiusTool({ getBlastRadius } as unknown as McpService);

    const result = await tool.handler({ repo: 'acme/widgets', pr: '42', file: 'src/foo.ts' });

    expect(getBlastRadius).toHaveBeenCalledWith('acme/widgets', '42', 'src/foo.ts');
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({ status: 'full', pr_id: 'pr-1' });
  });

  it('maps a missing-pr ServiceFailure to isError content with the next-step message', async () => {
    const getBlastRadius = vi.fn().mockResolvedValue({
      ok: false,
      failure: {
        kind: 'invalid_input',
        message: 'get_blast_radius needs a PR to analyze — pass pr=<number> to look up its blast radius.',
      },
    });
    const tool = makeGetBlastRadiusTool({ getBlastRadius } as unknown as McpService);

    const result = await tool.handler({ repo: 'acme/widgets', pr: undefined, file: undefined });

    expect(getBlastRadius).toHaveBeenCalledWith('acme/widgets', undefined, undefined);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('pass pr=<number>');
  });

  it('maps a repo_not_found ServiceFailure to isError content', async () => {
    const getBlastRadius = vi.fn().mockResolvedValue({ ok: false, failure: { kind: 'repo_not_found', message: 'not found' } });
    const tool = makeGetBlastRadiusTool({ getBlastRadius } as unknown as McpService);

    const result = await tool.handler({ repo: 'ghost/repo', pr: '1', file: undefined });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('not found');
  });
});
