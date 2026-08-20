import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

/**
 * Executable entry point (`npm start` / `npm run dev`, Step 1's scripts).
 * stdout is reserved for the MCP JSON-RPC protocol over stdio — every log
 * here goes to `console.error` (stderr), never `console.log`, or it would
 * corrupt the protocol stream for whatever MCP client launched this process.
 */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('DevDigest MCP server running on stdio');
}

main().catch((error: unknown) => {
  console.error('DevDigest MCP server failed to start:', error);
  process.exit(1);
});
