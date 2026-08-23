import type { z, ZodRawShape } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from './config.js';
import { DevDigestApiClient } from './http/client.js';
import type { DevDigestApiPort } from './http/types.js';
import { McpService } from './service/index.js';
import { makeGetBlastRadiusTool } from './tools/get-blast-radius.js';
import { makeGetConventionsTool } from './tools/get-conventions.js';
import { makeGetFindingsTool } from './tools/get-findings.js';
import { makeListAgentsTool } from './tools/list-agents.js';
import { makeRunAgentOnPrTool } from './tools/run-agent-on-pr.js';
import type { McpToolDescriptor } from './tools/types.js';

/**
 * Registers one tool descriptor against the server.
 *
 * The final `as any` pair is a narrow, deliberate escape hatch at this one
 * SDK boundary — see `mcp-server/INSIGHTS.md` for the full finding. In
 * short: `tsconfig.json`'s `paths` alias for `zod` (needed so the vendored
 * `@devdigest/shared` contracts, which physically live under `server/`,
 * resolve the *same* `zod` install this package uses) makes TypeScript
 * resolve our tools' `z.ZodOptional<...>` schemas through a different
 * module-resolution path than `@modelcontextprotocol/sdk`'s own internal
 * `zod/v3` import, so the two get treated as structurally different
 * classes and fail assignability — even though both are the exact same
 * `zod` package/version at runtime. `Args` (this function's own type
 * parameter) still gives the `args` parameter below its precise, checked
 * shape; only the final hand-off to the SDK's own generic is unchecked.
 */
function registerTool<Args extends ZodRawShape>(server: McpServer, descriptor: McpToolDescriptor<Args>): void {
  const config = {
    description: descriptor.description,
    inputSchema: descriptor.inputSchema,
    annotations: descriptor.annotations,
  };
  const handler = async (args: { [K in keyof Args]: z.infer<Args[K]> }) => {
    const result = await descriptor.handler(args);
    return { content: result.content, isError: result.isError };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.registerTool(descriptor.name, config as any, handler as any);
}

/**
 * Shared context for every tool, stated once here rather than repeated in
 * each tool's `description` (per the plan's §4 "non-redundant instructions
 * vs. description" rule). Each tool `description` only states *when* to
 * call it.
 */
const SERVER_INSTRUCTIONS = `This server is a thin client to the local DevDigest API (default \
http://localhost:3001; override with DEVDIGEST_API_URL). Start the API first with \
./scripts/dev.sh from the repo root — most tool failures are a connection error caused \
by skipping this step.

Identify a repo by its UUID or by \`owner/repo\` (e.g. "acme/widgets"). Identify a PR by \
its number (relative to its repo) or by its UUID.

Call list_agents before run_agent_on_pr to get a valid agent id/name — run_agent_on_pr \
costs real LLM spend and can take up to the configured hard timeout (default 120s), so \
don't call it speculatively.`;

/**
 * The composition root (Step 5 of `specs/mcp-server-plan.md`) — the one
 * place that knows every layer at once, mirroring `server/src/platform/container.ts`.
 * Reads config, wires the HTTP client (Step 2) into the application service
 * (Step 3), builds the MCP server, and registers the five thin presentation
 * tools (Step 4) against that service.
 *
 * Exported (rather than only called from `index.ts`) so Step 7's tests can
 * construct a server without going through real stdio.
 *
 * `client` is an optional `DevDigestApiPort` (the same DI seam
 * `McpService`'s own constructor uses, per `docs/architecture.md`) — tests
 * inject a mock port here instead of only being able to smoke-test tool
 * registration against the real `DevDigestApiClient`. Omitted in production
 * (`index.ts`'s call), where the real client is built from `loadConfig()`.
 */
export function createServer(client?: DevDigestApiPort): McpServer {
  const config = loadConfig();

  const apiClient =
    client ??
    new DevDigestApiClient({
      baseUrl: config.apiBaseUrl,
      requestTimeoutMs: config.requestTimeoutMs,
    });

  const service = new McpService(apiClient, {
    pollIntervalMs: config.pollIntervalMs,
    hardTimeoutMs: config.hardTimeoutMs,
  });

  const server = new McpServer(
    { name: 'devdigest-mcp-server', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerTool(server, makeListAgentsTool(service));
  registerTool(server, makeGetConventionsTool(service));
  registerTool(server, makeGetFindingsTool(service));
  registerTool(server, makeRunAgentOnPrTool(service));
  registerTool(server, makeGetBlastRadiusTool(service));

  return server;
}
