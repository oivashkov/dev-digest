import { z } from 'zod';
import type { McpService } from '../service/index.js';
import { toolFailure, toolSuccess } from './types.js';
import type { McpToolDescriptor } from './types.js';

const inputSchema = {
  repo: z.string().describe('Repo identifier — either its UUID or `owner/repo`.'),
  page: z.number().int().positive().optional().describe('1-based page number (default 1).'),
  page_size: z.number().int().positive().optional().describe('Items per page (default 20, max 100).'),
};

/**
 * Presentation layer (Step 4 of `specs/mcp-server-plan.md`). Thin: receives
 * the already-validated flat input, calls exactly one `service.*` method,
 * maps the typed `ServiceResult` to MCP content. No `fetch`, resolution, or
 * trimming here — that already happened in `McpService.getConventions`
 * (`src/service/index.ts`, Step 3).
 */
export function makeGetConventionsTool(service: McpService): McpToolDescriptor<typeof inputSchema> {
  return {
    name: 'get_conventions',
    description:
      'Call to read the accepted/candidate coding conventions detected for a repo, before or during a review, to ground findings against project-specific rules.',
    inputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    // `page_size` is accepted as input for forward-compatible pagination
    // symmetry with `get_findings`; `McpService.getConventions` (Step 3)
    // does not yet take a page-size override (its `page_size` in the
    // response is always `DEFAULT_PAGE_SIZE`), so it is not threaded
    // through here — see the implementation report's follow-ups.
    async handler({ repo, page }) {
      const result = await service.getConventions(repo, page);
      return result.ok ? toolSuccess(result.data) : toolFailure(result.failure);
    },
  };
}
