import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Hermetic-by-default Vitest config (Step 7 of `specs/mcp-server-plan.md`),
 * mirroring `reviewer-core/vitest.config.ts`'s pattern: the `@devdigest/shared`
 * alias points at the vendored contracts under `server/`, matching this
 * package's own `tsconfig.json` `paths` entry so tests resolve the exact same
 * schemas the runtime code validates against. No network, no LLM, no DB —
 * every external boundary (`fetch`, the HTTP-client port, the MCP SDK) is
 * mocked in the test files themselves or via `test/helpers/*`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
