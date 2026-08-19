/**
 * Intent Layer — `getOrComputeIntent` (server/src/modules/reviews/intent.ts).
 * Hermetic: stubbed container (db/git/vcsFor/llm/reviewRepo), no network.
 * Covers: the deterministic confidence tier, the path-traversal guard
 * (mandatory per docs/plans/intent-layer.md §9), the cache-reuse fast path,
 * and graceful degradation (never throws) when the LLM or VCS call fails.
 */
import { describe, it, expect, vi } from 'vitest';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import {
  getOrComputeIntent,
  tierFor,
  isAllowedPlanRefShape,
  isWithinClone,
  isSafePlanRefPath,
  computeScopeDrift,
} from '../src/modules/reviews/intent.js';
import type { Container } from '../src/platform/container.js';
import type { Intent } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// tierFor — deterministic confidence tier
// ---------------------------------------------------------------------------

describe('tierFor', () => {
  it('is high (0.9, source=spec) when a plan/spec ref resolved, even with other signals present', () => {
    expect(
      tierFor({ hasResolvedPlanRef: true, hasTicketBody: true, hasDescription: true }),
    ).toEqual({ confidence: 0.9, source: 'spec' });
  });

  it('is high (0.9, source=ticket) when a linked ticket has a body but no plan ref resolved', () => {
    expect(
      tierFor({ hasResolvedPlanRef: false, hasTicketBody: true, hasDescription: true }),
    ).toEqual({ confidence: 0.9, source: 'ticket' });
  });

  it('is medium (0.7, source=description) with only a meaningful description', () => {
    expect(
      tierFor({ hasResolvedPlanRef: false, hasTicketBody: false, hasDescription: true }),
    ).toEqual({ confidence: 0.7, source: 'description' });
  });

  it('is low (0.25, source=inferred) with no signals at all', () => {
    expect(
      tierFor({ hasResolvedPlanRef: false, hasTicketBody: false, hasDescription: false }),
    ).toEqual({ confidence: 0.25, source: 'inferred' });
  });
});

// ---------------------------------------------------------------------------
// computeScopeDrift — deterministic, advisory (docs/plans/intent-scope-drift.md)
// ---------------------------------------------------------------------------

describe('computeScopeDrift', () => {
  it('flags a file whose path token overlaps an out_of_scope phrase', () => {
    expect(
      computeScopeDrift(
        [{ path: 'src/api/auth/login.ts' }, { path: 'src/middleware/ratelimit.ts' }],
        ['auth flow'],
      ),
    ).toEqual([{ file: 'src/api/auth/login.ts', matched_phrase: 'auth flow' }]);
  });

  it('is case-insensitive and matches across camelCase/path/extension boundaries', () => {
    expect(
      computeScopeDrift([{ path: 'src/webhookHandler.ts' }], ['Webhook payload validation']),
    ).toEqual([{ file: 'src/webhookHandler.ts', matched_phrase: 'Webhook payload validation' }]);
  });

  it('does not flag a file with no token overlap', () => {
    expect(
      computeScopeDrift([{ path: 'src/middleware/ratelimit.ts' }], ['auth flow']),
    ).toEqual([]);
  });

  it('ignores generic/structural path segments (index, utils, ...) as false-positive bait', () => {
    // "index" alone would otherwise match a phrase like "the index page" for
    // almost any repo's src/index.ts — dropped from the file-token set.
    expect(
      computeScopeDrift([{ path: 'src/index.ts' }], ['redesign the index page']),
    ).toEqual([]);
  });

  it('ignores tokens shorter than the minimum length (avoids matching on noise like "ts"/"id")', () => {
    expect(computeScopeDrift([{ path: 'src/id.ts' }], ['user id lookup'])).toEqual([]);
  });

  it('returns [] when out_of_scope is empty, without matching everything by default', () => {
    expect(computeScopeDrift([{ path: 'src/api/auth/login.ts' }], [])).toEqual([]);
  });

  it('returns [] when there are no changed files', () => {
    expect(computeScopeDrift([], ['auth flow'])).toEqual([]);
  });

  it('reports at most one hit per file — the first matching phrase, not every match', () => {
    expect(
      computeScopeDrift(
        [{ path: 'src/api/auth/webhook.ts' }],
        ['auth flow', 'webhook delivery'],
      ),
    ).toEqual([{ file: 'src/api/auth/webhook.ts', matched_phrase: 'auth flow' }]);
  });

  it('preserves original file order and caps at 15 hits', () => {
    const files = Array.from({ length: 20 }, (_, i) => ({ path: `src/auth/file${i}.ts` }));
    const hits = computeScopeDrift(files, ['auth flow']);
    expect(hits).toHaveLength(15);
    expect(hits[0]).toEqual({ file: 'src/auth/file0.ts', matched_phrase: 'auth flow' });
    expect(hits[14]).toEqual({ file: 'src/auth/file14.ts', matched_phrase: 'auth flow' });
  });
});

// ---------------------------------------------------------------------------
// Path-traversal guard — mandatory per docs/plans/intent-layer.md §9
// ---------------------------------------------------------------------------

describe('path-traversal guard', () => {
  const clonePath = '/mock/clones/acme/app';

  it('rejects a classic traversal payload', () => {
    expect(isAllowedPlanRefShape('../../../../etc/passwd')).toBe(false);
    expect(isWithinClone(clonePath, '../../../../etc/passwd')).toBe(false);
    expect(isSafePlanRefPath(clonePath, '../../../../etc/passwd')).toBe(false);
  });

  it('rejects an absolute path even without a ".." segment', () => {
    expect(isAllowedPlanRefShape('/etc/passwd')).toBe(false);
    expect(isSafePlanRefPath(clonePath, '/etc/passwd')).toBe(false);
  });

  it('rejects a shape outside the specs/docs allowlist', () => {
    expect(isAllowedPlanRefShape('src/index.ts')).toBe(false);
    expect(isAllowedPlanRefShape('README.md')).toBe(false);
  });

  it('accepts specs/*.md, docs/**/*.md, and docs/plans/** shapes within the clone', () => {
    expect(isSafePlanRefPath(clonePath, 'specs/intent-layer.md')).toBe(true);
    expect(isSafePlanRefPath(clonePath, 'docs/sub/dir/notes.md')).toBe(true);
    expect(isSafePlanRefPath(clonePath, 'docs/plans/intent-layer.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getOrComputeIntent — cache reuse + graceful degradation
// ---------------------------------------------------------------------------

const PULL = {
  id: 'pr-1',
  number: 42,
  title: 'Simplify the retry loop',
  body: 'A description long enough to count as meaningful signal for the description tier.',
  additions: 10,
  deletions: 2,
  filesCount: 1,
} as never;

const REPO = {
  id: 'repo-1',
  owner: 'acme',
  name: 'app',
  fullName: 'acme/app',
  provider: 'github' as const,
  host: 'github.com',
  insecureTls: false,
} as never;

const RUN_LOG = { info: vi.fn(), step: vi.fn(), tool: vi.fn(), result: vi.fn(), error: vi.fn() } as never;

function makeContainer(opts: {
  llm?: MockLLMProvider | { completeStructured: () => Promise<never> };
  getIntent?: () => Promise<Intent | undefined>;
  upsertIntent?: (prId: string, intent: Intent) => Promise<void>;
  vcsThrows?: boolean;
}): Container {
  const db = { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) };
  const llm = opts.llm ?? new MockLLMProvider('openai', {
    structuredBySchema: {
      IntentExtraction: { intent: 'Simplify retry logic', in_scope: ['retry loop'], out_of_scope: [] },
    },
  });
  return {
    db,
    git: {
      clonePathFor: () => '/mock/clones/acme/app',
      readFile: async () => {
        throw new Error('no plan ref in this fixture');
      },
    },
    vcsFor: async () => {
      if (opts.vcsThrows) throw new Error('no token / offline');
      return { getPullRequest: async () => ({ linked_issue: null }) };
    },
    llm: async () => llm,
    reviewRepo: {
      getIntent: opts.getIntent ?? (async () => undefined),
      upsertIntent: opts.upsertIntent ?? (async () => undefined),
      getPrFiles: async () => [],
    },
  } as unknown as Container;
}

describe('getOrComputeIntent', () => {
  it('reuses a cached intent without calling the LLM (force: false)', async () => {
    const cached: Intent = {
      intent: 'cached intent',
      in_scope: [],
      out_of_scope: [],
      confidence: 0.9,
      source: 'spec',
      plan_refs: [],
    };
    const llm = new MockLLMProvider('openai');
    const container = makeContainer({ llm, getIntent: async () => cached });

    const result = await getOrComputeIntent(container, 'ws-1', REPO, PULL, { force: false }, RUN_LOG);

    expect(result).toEqual(cached);
    expect(llm.calls).toEqual([]);
  });

  it('computes, tiers, and persists a fresh intent when there is no cache', async () => {
    const upsertIntent = vi.fn(async () => undefined);
    const container = makeContainer({ upsertIntent });

    const result = await getOrComputeIntent(container, 'ws-1', REPO, PULL, { force: false }, RUN_LOG);

    expect(result?.intent).toBe('Simplify retry logic');
    // No plan ref / ticket resolved in this fixture, but the description is
    // meaningful (> 40 chars) → medium tier.
    expect(result?.confidence).toBe(0.7);
    expect(result?.source).toBe('description');
    expect(upsertIntent).toHaveBeenCalledWith('pr-1', expect.objectContaining({ source: 'description' }));
  });

  it('degrades to undefined (never throws) when the LLM call fails', async () => {
    const container = makeContainer({
      llm: { completeStructured: async () => { throw new Error('provider down'); } },
    });

    const result = await getOrComputeIntent(container, 'ws-1', REPO, PULL, { force: false }, RUN_LOG);

    expect(result).toBeUndefined();
  });

  it('degrades to undefined (never throws) when model resolution / the LLM provider is unavailable', async () => {
    const container = makeContainer({});
    // Simulate the same "no API key configured" failure `container.llm()`
    // throws for real (ConfigError) — model resolution is on the same
    // failure path as an unavailable VCS: both are external dependencies
    // this function must degrade around, never propagate.
    (container as unknown as { llm: () => Promise<never> }).llm = async () => {
      throw new Error('OPENROUTER_API_KEY is not configured');
    };

    const result = await getOrComputeIntent(container, 'ws-1', REPO, PULL, { force: false }, RUN_LOG);

    expect(result).toBeUndefined();
  });

  it('tolerates the VCS ticket fetch being unavailable — degrades to no ticket, not to undefined', async () => {
    const noSignalPull = { ...PULL, body: null } as never;
    const container = makeContainer({ vcsThrows: true });

    // Ticket-fetch failure alone is best-effort (caught inside computeIntent,
    // per docs/plans/intent-layer.md §1: "VCS may be unavailable/offline,
    // degrade to no ticket") — the overall call still succeeds, just with
    // the lowest (inferred) tier since no signal resolved.
    const result = await getOrComputeIntent(container, 'ws-1', REPO, noSignalPull, { force: false }, RUN_LOG);

    expect(result?.source).toBe('inferred');
    expect(result?.confidence).toBe(0.25);
  });
});
