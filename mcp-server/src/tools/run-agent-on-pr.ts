import { z } from 'zod';
import type { McpService } from '../service/index.js';
import { toolFailure, toolSuccess } from './types.js';
import type { McpToolDescriptor } from './types.js';

const inputSchema = {
  repo: z.string().describe('Repo identifier — either its UUID or `owner/repo`.'),
  pr: z.string().describe('PR identifier — either its UUID or its number.'),
  agent: z.string().describe('Reviewer agent identifier — either its UUID or its exact name from list_agents.'),
};

/**
 * Presentation layer (Step 4 of `specs/mcp-server-plan.md`). Thin: receives
 * the already-validated flat input, calls exactly one `service.*` method,
 * maps the typed result to MCP content. No `fetch`, resolution, polling, or
 * trimming here — the run+poll+timeout-fallback orchestration and the
 * `run_failed` failure detection live in `McpService.runAgentOnPr`
 * (`src/service/index.ts`, Step 3). Not read-only/idempotent — it costs real
 * LLM spend and creates a run, so the description says so explicitly.
 */
export function makeRunAgentOnPrTool(service: McpService): McpToolDescriptor<typeof inputSchema> {
  return {
    name: 'run_agent_on_pr',
    description:
      'Call to start a reviewer agent run on a PR and wait for it to complete. This costs real LLM spend and can take up to the configured hard timeout (default 120s); call list_agents first to get a valid agent id/name.',
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async handler({ repo, pr, agent }) {
      const result = await service.runAgentOnPr(repo, pr, agent);
      return result.ok ? toolSuccess(result.data) : toolFailure(result.failure);
    },
  };
}
