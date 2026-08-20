import { vi } from 'vitest';
import type { DevDigestApiPort } from '../../src/http/types.js';

/** A `DevDigestApiPort` (`src/http/types.ts`) whose every method is a `vi.fn()`, for service-layer tests. */
export type MockApiClient = {
  [K in keyof DevDigestApiPort]: ReturnType<typeof vi.fn>;
};

/**
 * Builds a mock `DevDigestApiPort` — the infrastructure port the application
 * service (`src/service/**`, Step 3) depends on — for hermetic service-layer
 * tests (Step 7). Mirrors `server/src/adapters/mocks.ts`'s role: a test swaps
 * this in via constructor injection instead of mocking `fetch`, so
 * `McpService`/`resolve.ts` tests exercise real orchestration logic against a
 * controllable, in-memory double of the DevDigest API.
 *
 * Every method defaults to an empty/benign resolution so a test only needs to
 * override the calls it cares about.
 */
export function createMockApiClient(overrides: Partial<MockApiClient> = {}): MockApiClient {
  return {
    listAgents: vi.fn().mockResolvedValue([]),
    listRepos: vi.fn().mockResolvedValue([]),
    listPulls: vi.fn().mockResolvedValue([]),
    runReview: vi.fn().mockResolvedValue({ pr_id: 'pr-1', runs: [], reviews: [] }),
    listReviews: vi.fn().mockResolvedValue([]),
    listRuns: vi.fn().mockResolvedValue([]),
    getConventions: vi.fn().mockResolvedValue({
      candidates: [],
      sample_file_count: 0,
      last_scan_at: null,
      scan_status: 'idle',
    }),
    getBlastRadius: vi.fn().mockResolvedValue({
      pr_id: 'pr-1',
      repo_id: 'repo-1',
      symbols: [],
      impacted_endpoints: [],
      impacted_crons: [],
      counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      status: 'full',
      reason: null,
    }),
    ...overrides,
  };
}
