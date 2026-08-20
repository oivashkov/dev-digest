import { describe, expect, it, vi } from 'vitest';
import { makeListAgentsTool } from './list-agents.js';
import type { McpService } from '../service/index.js';

/**
 * Presentation-layer test (Step 7) — asserts only the
 * result→content/`isError` mapping against a mocked service; the heavy
 * logic (`McpService.listAgents`) is already covered in
 * `src/service/index.test.ts` (Step 3).
 */
describe('list_agents tool', () => {
  it('maps a successful ServiceResult to non-error text content', async () => {
    const listAgents = vi.fn().mockResolvedValue({ ok: true, data: { agents: [{ id: 'a1' }] } });
    const tool = makeListAgentsTool({ listAgents } as unknown as McpService);

    const result = await tool.handler({});

    expect(listAgents).toHaveBeenCalledOnce();
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({ agents: [{ id: 'a1' }] });
  });

  it('maps a ServiceFailure to isError content carrying the next-step message verbatim', async () => {
    const listAgents = vi
      .fn()
      .mockResolvedValue({ ok: false, failure: { kind: 'unreachable', message: 'start it with ./scripts/dev.sh' } });
    const tool = makeListAgentsTool({ listAgents } as unknown as McpService);

    const result = await tool.handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('start it with ./scripts/dev.sh');
  });

  it('declares itself read-only, idempotent, and open-world', () => {
    const tool = makeListAgentsTool({} as unknown as McpService);
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true, openWorldHint: true });
    expect(tool.name).toBe('list_agents');
  });
});
