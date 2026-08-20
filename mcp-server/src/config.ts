import { z } from 'zod';

/**
 * Central, zod-validated environment config for the DevDigest MCP server.
 * Loaded once, in the composition root (`src/server.ts`, Step 5), and its
 * values are threaded into the HTTP client (`src/http/client.ts`, Step 2)
 * and the application service (`src/service/**`, Step 3) via constructor
 * injection — never read from `process.env` outside this file.
 *
 * No secrets live here. The only external value is the local DevDigest API
 * base URL, which is safe to read from env because it is never
 * attacker-controlled and never reaches `fetch` un-validated (see
 * `security` skill: "fetch(process.env.API_URL) = safe").
 */
const EnvSchema = z.object({
  /** Base URL of the local DevDigest Fastify API. Matches server's API_PORT default (3001). */
  DEVDIGEST_API_URL: z.string().url().default('http://localhost:3001'),
  /** Poll interval (ms) for the run_agent_on_pr timeout-fallback loop against GET /pulls/:id/reviews. */
  MCP_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  /** Hard ceiling (ms) for the run_agent_on_pr poll loop before returning a timeout-fallback result. */
  MCP_HARD_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /** Per-request timeout (ms) applied to every individual HTTP call to the DevDigest API. */
  MCP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export type McpServerConfig = {
  /** Base URL of the local DevDigest Fastify API, e.g. http://localhost:3001. */
  apiBaseUrl: string;
  /** Poll interval (ms) used by the run_agent_on_pr timeout-fallback loop. */
  pollIntervalMs: number;
  /** Hard ceiling (ms) for the run_agent_on_pr poll loop. */
  hardTimeoutMs: number;
  /** Per-request timeout (ms) for a single HTTP call to the DevDigest API. */
  requestTimeoutMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  const parsed = EnvSchema.parse(env);
  return {
    apiBaseUrl: parsed.DEVDIGEST_API_URL,
    pollIntervalMs: parsed.MCP_POLL_INTERVAL_MS,
    hardTimeoutMs: parsed.MCP_HARD_TIMEOUT_MS,
    requestTimeoutMs: parsed.MCP_REQUEST_TIMEOUT_MS,
  };
}
