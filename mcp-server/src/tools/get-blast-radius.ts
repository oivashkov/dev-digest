import { z } from 'zod';
import type { McpService } from '../service/index.js';
import { toolFailure, toolSuccess } from './types.js';
import type { McpToolDescriptor } from './types.js';

const inputSchema = {
  repo: z.string().describe('Repo identifier — either its UUID or `owner/repo`.'),
  pr: z.string().optional().describe('PR identifier — either its UUID or its number.'),
  file: z.string().optional().describe('A specific file path to scope the analysis to.'),
};

/**
 * Presentation layer (Step 4 of `specs/mcp-server-plan.md`). Thin wrapper
 * over `McpService.getBlastRadius` (`src/service/index.ts`, Step 3), which
 * resolves `repo`+`pr` and calls `GET /pulls/:id/blast` — deterministic
 * (no LLM call). `pr` is required despite being optional in `inputSchema`
 * below (kept optional there for input-shape symmetry with the other
 * tools): the service returns a typed `invalid_input` failure with a
 * next-step message when it's omitted. `file`, when given, narrows the
 * result to symbols declared in that file — a pure client-side filter, not
 * a server query param.
 */
export function makeGetBlastRadiusTool(service: McpService): McpToolDescriptor<typeof inputSchema> {
  return {
    name: 'get_blast_radius',
    description:
      "Get a PR's blast radius: symbols declared in its changed files, who calls them (file:line, ranked by importance), and which HTTP endpoints/cron jobs are reachable within a 2-level reverse import walk. Deterministic — no LLM call. Requires pr. Pass file to scope the result to symbols declared in one specific file.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler({ repo, pr, file }) {
      const result = await service.getBlastRadius(repo, pr, file);
      return result.ok ? toolSuccess(result.data) : toolFailure(result.failure);
    },
  };
}
