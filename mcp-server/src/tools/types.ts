import type { z, ZodRawShape } from 'zod';
import type { ServiceFailure } from '../service/results.js';

/**
 * Shared descriptor type for the presentation layer (Step 4 of
 * `specs/mcp-server-plan.md`). Each `src/tools/*.ts` file exports a
 * `makeXTool(service: McpService)` factory returning one of these — a plain,
 * SDK-shape-compatible object that owns no dependency on
 * `@modelcontextprotocol/sdk` itself (only its `inputSchema` shape is
 * SDK-flavored, being a Zod raw shape). The composition root (`src/server.ts`,
 * Step 5) is the only place that calls
 * `server.registerTool(descriptor.name, { description, inputSchema, annotations }, descriptor.handler)`.
 *
 * `Args` is the Zod raw shape (`{ key: z.something() }`, NOT `z.object(...)`)
 * used for `inputSchema` — matching `@modelcontextprotocol/sdk`'s
 * `registerTool` `InputArgs extends ZodRawShapeCompat` constraint.
 */

/** MCP tool annotation hints — mirrors `@modelcontextprotocol/sdk`'s `ToolAnnotations` (all fields optional, camelCase). */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** A single `{ type: 'text', text }` content block — the only content kind these tools emit. */
export interface McpTextContent {
  type: 'text';
  text: string;
}

/** The shape every tool handler resolves to — matches `@modelcontextprotocol/sdk`'s `CallToolResult` surface this package uses. */
export interface McpToolHandlerResult {
  content: McpTextContent[];
  isError?: boolean;
}

export interface McpToolDescriptor<Args extends ZodRawShape> {
  /** verb_noun tool name, e.g. `list_agents`. */
  readonly name: string;
  /** States only *when* to call it — shared context lives once in the server's `instructions` (Step 5), not repeated per tool. */
  readonly description: string;
  /** Zod raw shape (`{ key: z.something() }`), never `z.object(...)` — passed to `registerTool`'s `inputSchema`. */
  readonly inputSchema: Args;
  readonly annotations: McpToolAnnotations;
  /** Receives the already-validated flat input; calls exactly one `service.*` method; maps the result to content/`isError`. No `fetch`, no resolution, no trimming here. */
  readonly handler: (args: { [K in keyof Args]: z.infer<Args[K]> }) => Promise<McpToolHandlerResult>;
}

/**
 * Maps a successful `ServiceResult`'s `data` payload to MCP content — a
 * single `text` block carrying the concise structured payload as pretty
 * JSON. Every tool handler's success path funnels through this so the
 * mapping (step 3 of the presentation contract, per the plan's Step 4) is
 * identical across all five tools.
 */
export function toolSuccess(data: unknown): McpToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/**
 * Maps a `ServiceFailure` to `isError: true` MCP content, carrying
 * `failure.message` verbatim — the next-step-oriented text produced by the
 * service layer, never re-derived or re-worded here.
 */
export function toolFailure(failure: ServiceFailure): McpToolHandlerResult {
  return { content: [{ type: 'text', text: failure.message }], isError: true };
}
