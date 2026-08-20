import { describe, expect, it, vi } from 'vitest';
import { makeGetConventionsTool } from './get-conventions.js';
import type { McpService } from '../service/index.js';

/** Presentation-layer test (Step 7) — result→content/`isError` mapping only. */
describe('get_conventions tool', () => {
  it('calls McpService.getConventions with the flat repo/page args and maps success', async () => {
    const getConventions = vi.fn().mockResolvedValue({
      ok: true,
      data: { scan_status: 'idle', last_scan_at: null, conventions: [], page: 1, page_size: 20, total: 0 },
    });
    const tool = makeGetConventionsTool({ getConventions } as unknown as McpService);

    const result = await tool.handler({ repo: 'acme/widgets', page: 2, page_size: 10 });

    expect(getConventions).toHaveBeenCalledWith('acme/widgets', 2);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({ scan_status: 'idle' });
  });

  it('maps a repo-not-found failure to isError content', async () => {
    const getConventions = vi
      .fn()
      .mockResolvedValue({ ok: false, failure: { kind: 'repo_not_found', message: 'check the name, or import it first' } });
    const tool = makeGetConventionsTool({ getConventions } as unknown as McpService);

    const result = await tool.handler({ repo: 'ghost/repo', page: undefined, page_size: undefined });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('check the name, or import it first');
  });
});
