import { describe, expect, it } from 'vitest';
import { createServer } from './server.js';

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
});
