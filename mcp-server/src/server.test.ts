import { describe, expect, it, vi } from 'vitest';
import { createServer } from './server.js';
import { createMockApiClient } from '../test/helpers/mock-api-client.js';
import { makeAgent } from '../test/helpers/fixtures.js';

/**
 * Composition-root smoke test (Step 7, deferred here from Step 5's own "Tests
 * to run/add" note in `specs/mcp-server-plan.md`). Asserts `createServer()`
 * wires all five tool descriptors with their expected names and annotation
 * flags, against the real `DevDigestApiClient` (constructed but never
 * called — no network happens at construction time) and real
 * `@modelcontextprotocol/sdk` `McpServer`. Does NOT drive a real stdio
 * transport end-to-end; that is the optional `MCP_IT=1` integration test
 * this step skipped (see the implementation report) or a manual handshake.
 */
describe('createServer (composition root)', () => {
  it('registers exactly five tools with the expected names and annotation flags', () => {
    const server = createServer();

    // `_registeredTools` is TS-private but JS-public at runtime on the SDK's
    // `McpServer` (v1.30) — the same narrow, deliberate SDK-boundary reach
    // `registerTool` in this file documents for its own `as any` escape
    // hatch. Used here only to introspect what got wired, not to drive
    // requests through it.
    const registered = (
      server as unknown as {
        _registeredTools: Record<string, { annotations?: Record<string, unknown> }>;
      }
    )._registeredTools;
    const names = Object.keys(registered).sort();

    expect(names).toEqual(
      ['get_blast_radius', 'get_conventions', 'get_findings', 'list_agents', 'run_agent_on_pr'].sort(),
    );
    expect(registered.list_agents?.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(registered.run_agent_on_pr?.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false });
    expect(registered.get_blast_radius?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });

  it('wires an injected DevDigestApiPort through to a tool call, instead of always building the real client', async () => {
    // The DI seam: createServer(client) lets a test drive a real tool
    // handler end-to-end (McpServer -> McpService -> port) against a mock,
    // without a running DevDigest API — see the constructor's doc comment.
    const listAgents = vi.fn().mockResolvedValue([makeAgent({ id: 'a1', name: 'Reviewer' })]);
    const client = createMockApiClient({ listAgents });
    const server = createServer(client);

    const registered = (
      server as unknown as {
        _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: { text: string }[] }> }>;
      }
    )._registeredTools;

    const result = await registered.list_agents?.handler({});

    expect(listAgents).toHaveBeenCalledOnce();
    expect(JSON.parse(result?.content[0]?.text ?? '')).toEqual({
      agents: [{ id: 'a1', name: 'Reviewer', model: 'gpt-4o', enabled: true, strategy: 'single-pass' }],
    });
  });
});
