import { z } from 'zod';
import type { McpService } from '../service/index.js';
import { toolFailure, toolSuccess } from './types.js';
import type { McpToolDescriptor } from './types.js';

const inputSchema = {
  repo: z.string().describe('Repo identifier — either its UUID or `owner/repo`.'),
  pr: z.string().describe('PR identifier — either its UUID or its number.'),
  run_id: z.string().optional().describe('A specific run id to read findings for. Omit to get the most recent completed review.'),
  page: z.number().int().positive().optional().describe('1-based page number (default 1).'),
  page_size: z.number().int().positive().optional().describe('Findings per page (default 20, max 100).'),
};

/**
 * Presentation layer (Step 4 of `specs/mcp-server-plan.md`). Thin: receives
 * the already-validated flat input, calls exactly one `service.*` method,
 * maps the typed `ServiceResult` to MCP content. No `fetch`, resolution, or
 * trimming here — that already happened in `McpService.getFindings`
 * (`src/service/index.ts`, Step 3), including the explicit
 * `no_reviews_yet`/`run_not_found` failures — those surface here as
 * `isError` content carrying the service's next-step message verbatim,
 * never a silent empty `findings: []`.
 */
export function makeGetFindingsTool(service: McpService): McpToolDescriptor<typeof inputSchema> {
  return {
    name: 'get_findings',
    description:
      'Call to read findings from a completed review on a PR — the most recent one by default, or a specific run via run_id.',
    inputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler({ repo, pr, run_id, page, page_size }) {
      const result = await service.getFindings(repo, pr, run_id, page, page_size);
      return result.ok ? toolSuccess(result.data) : toolFailure(result.failure);
    },
  };
}
