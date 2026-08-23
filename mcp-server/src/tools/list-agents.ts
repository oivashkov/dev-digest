import type { McpService } from '../service/index.js';
import { toolFailure, toolSuccess } from './types.js';
import type { McpToolDescriptor } from './types.js';

/** Empty raw shape — `list_agents` takes no input. */
const inputSchema = {};

/**
 * Presentation layer (Step 4 of `specs/mcp-server-plan.md`). Thin: receives
 * the (empty) validated input, calls exactly one `service.*` method, maps
 * the typed `ServiceResult` to MCP content. No `fetch`, resolution, or
 * trimming here — that already happened in `McpService.listAgents`
 * (`src/service/index.ts`, Step 3).
 */
export function makeListAgentsTool(service: McpService): McpToolDescriptor<typeof inputSchema> {
  return {
    name: 'list_agents',
    description:
      'Call first to discover which reviewer agents exist and their exact ids/names before running one.',
    inputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler() {
      const result = await service.listAgents();
      return result.ok ? toolSuccess(result.data) : toolFailure(result.failure);
    },
  };
}
