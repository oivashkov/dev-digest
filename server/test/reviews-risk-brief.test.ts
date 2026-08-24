/**
 * PR Why + Risk Brief — `getOrComputeRiskBrief`
 * (server/src/modules/reviews/risk-brief.ts). Hermetic: stubbed container
 * (db/git/vcsFor/llm/reviewRepo/repoIntel), no network — mirrors
 * `test/reviews-intent.test.ts`'s stubbed-`Container` approach.
 *
 * Covers: cached hit skips the LLM (AC2), concurrent calls share one
 * in-flight compute (AC4), grounding drops ungrounded risks/review_focus
 * items and `risk_level` is recomputed from the survivors (AC11-14), empty
 * post-grounding risks default to 'low' (AC16), a compute failure leaves any
 * existing cache untouched (AC18), a traversal payload in `plan_refs` is
 * never passed to `readFile`, and a zero-changed-files PR degrades to a
 * minimal brief rather than throwing.
 */
import { describe, it, expect, vi } from 'vitest';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { getOrComputeRiskBrief, riskLevelFor } from '../src/modules/reviews/risk-brief.js';
import type { Container } from '../src/platform/container.js';
import type { Intent, PrRiskBrief, Risk } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// riskLevelFor — deterministic max-severity, never a model self-report
// ---------------------------------------------------------------------------

describe('riskLevelFor', () => {
  const risk = (severity: Risk['severity']): Risk => ({
    kind: 'test',
    title: 't',
    explanation: 'e',
    severity,
    file_refs: [],
  });

  it('is "low" when risks is empty (AC16)', () => {
    expect(riskLevelFor([])).toBe('low');
  });

  it('is the max severity across risks', () => {
    expect(riskLevelFor([risk('low'), risk('medium')])).toBe('medium');
    expect(riskLevelFor([risk('low'), risk('high'), risk('medium')])).toBe('high');
  });

  it('does not downgrade once a higher severity is seen, regardless of order', () => {
    expect(riskLevelFor([risk('high'), risk('low')])).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// getOrComputeRiskBrief — cache reuse, in-flight dedup, grounding, degrade
// ---------------------------------------------------------------------------

const PULL = {
  id: 'pr-1',
  number: 42,
  repoId: 'repo-1',
  title: 'Simplify the retry loop',
  body: 'A description long enough to count as meaningful signal for the description tier.',
  additions: 10,
  deletions: 2,
  filesCount: 1,
  headSha: 'sha-abc123',
} as never;

const EMPTY_PULL = {
  ...PULL,
  body: null,
  additions: 0,
  deletions: 0,
  filesCount: 0,
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

const DEFAULT_INTENT_FIXTURE = { intent: 'Simplify retry logic', in_scope: ['retry loop'], out_of_scope: [] };
const DEFAULT_BRIEF_FIXTURE = { what: 'Simplifies the retry loop', why: 'Reduce flakiness', risks: [], review_focus: [] };

function makeContainer(opts: {
  llm?: MockLLMProvider | { completeStructured: (req: { schemaName: string }) => Promise<never> };
  getPrBrief?: () => Promise<PrRiskBrief | undefined>;
  upsertPrBrief?: (prId: string, brief: PrRiskBrief) => Promise<void>;
  getIntent?: () => Promise<Intent | undefined>;
  files?: { path: string; additions: number; deletions: number }[];
  readFile?: (repo: unknown, path: string) => Promise<string>;
}): Container {
  const db = { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) };
  const llm =
    opts.llm ??
    new MockLLMProvider('openai', {
      structuredBySchema: {
        IntentExtraction: DEFAULT_INTENT_FIXTURE,
        RiskBriefExtraction: DEFAULT_BRIEF_FIXTURE,
      },
    });
  return {
    db,
    git: {
      clonePathFor: () => '/mock/clones/acme/app',
      readFile:
        opts.readFile ??
        (async () => {
          throw new Error('no plan ref in this fixture');
        }),
    },
    vcsFor: async () => ({ getPullRequest: async () => ({ linked_issue: null }) }),
    llm: async () => llm,
    reviewRepo: {
      getIntent: opts.getIntent ?? (async () => undefined),
      upsertIntent: async () => undefined,
      getPrFiles: async () => opts.files ?? [],
      getPrBrief: opts.getPrBrief ?? (async () => undefined),
      upsertPrBrief: opts.upsertPrBrief ?? (async () => undefined),
    },
    repoIntel: {
      getBlastRadius: async () => ({
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        impactedCrons: [],
        downstreamFiles: [],
      }),
      getIndexState: async () => ({
        repoId: 'repo-1',
        status: 'full',
        filesIndexed: 1,
        filesSkipped: 0,
        durationMs: 1,
        lastIndexedSha: 'sha',
        indexerVersion: 1,
        updatedAt: new Date(),
      }),
    },
    // Deterministic stub matching `approxTokens` — every fixture in this
    // file is well under the 8,000-token budget, so no test here exercises
    // trimming; that lives in `reviews-risk-brief-budget.test.ts`. Needed
    // regardless: `computeRiskBrief` reads `container.tokenizer` on every
    // call now, and this hand-rolled `Container` cast has no real one.
    tokenizer: { count: (t: string) => Math.ceil(t.length / 4) },
  } as unknown as Container;
}

describe('getOrComputeRiskBrief', () => {
  it('reuses a cached brief without calling the LLM (AC2)', async () => {
    const cached: PrRiskBrief = {
      what: 'cached what',
      why: 'cached why',
      risks: [],
      review_focus: [],
      pr_id: 'pr-1',
      risk_level: 'low',
      head_sha: 'sha-abc123',
    };
    const llm = new MockLLMProvider('openai');
    const container = makeContainer({ llm, getPrBrief: async () => cached });

    const result = await getOrComputeRiskBrief(container, 'ws-1', REPO, PULL, { force: false }, RUN_LOG);

    expect(result).toEqual(cached);
    expect(llm.calls).toEqual([]);
  });

  it('shares one in-flight compute across two concurrent calls (AC4)', async () => {
    const upsertPrBrief = vi.fn(async () => undefined);
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        IntentExtraction: DEFAULT_INTENT_FIXTURE,
        RiskBriefExtraction: DEFAULT_BRIEF_FIXTURE,
      },
    });
    const container = makeContainer({ llm, upsertPrBrief });

    const [a, b] = await Promise.all([
      getOrComputeRiskBrief(container, 'ws-1', REPO, PULL, { force: false }, RUN_LOG),
      getOrComputeRiskBrief(container, 'ws-1', REPO, PULL, { force: false }, RUN_LOG),
    ]);

    expect(a).toEqual(b);
    const briefCalls = llm.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'RiskBriefExtraction',
    );
    expect(briefCalls).toHaveLength(1);
    expect(upsertPrBrief).toHaveBeenCalledTimes(1);
  });

  it('drops ungrounded risks/review_focus items and recomputes risk_level from the survivors (AC11-14)', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        IntentExtraction: DEFAULT_INTENT_FIXTURE,
        RiskBriefExtraction: {
          what: 'Touches auth',
          why: 'Fixes a bug',
          risks: [
            {
              kind: 'security',
              title: 'real risk',
              explanation: 'cites a real changed file',
              severity: 'medium',
              file_refs: ['src/real.ts'],
            },
            {
              kind: 'security',
              title: 'hallucinated risk',
              explanation: 'cites a file not in the diff',
              severity: 'high',
              file_refs: ['src/does-not-exist.ts'],
            },
          ],
          review_focus: [
            { file: 'src/real.ts', reason: 'core change' },
            { file: 'src/does-not-exist.ts', reason: 'hallucinated file' },
            { file: 'src/real.ts', endpoint: 'GET /nope', reason: 'hallucinated endpoint' },
          ],
        },
      },
    });
    const container = makeContainer({
      llm,
      files: [{ path: 'src/real.ts', additions: 5, deletions: 1 }],
    });

    const result = await getOrComputeRiskBrief(container, 'ws-1', REPO, PULL, { force: false }, RUN_LOG);

    expect(result?.risks).toEqual([
      expect.objectContaining({ title: 'real risk', file_refs: ['src/real.ts'] }),
    ]);
    expect(result?.review_focus).toEqual([expect.objectContaining({ file: 'src/real.ts', reason: 'core change' })]);
    // Only the surviving risk (medium) counts — the hallucinated 'high' one
    // was dropped, so risk_level must NOT be 'high'.
    expect(result?.risk_level).toBe('medium');
  });

  it('defaults risk_level to "low" when every risk fails grounding (AC16)', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        IntentExtraction: DEFAULT_INTENT_FIXTURE,
        RiskBriefExtraction: {
          what: 'what',
          why: 'why',
          risks: [
            {
              kind: 'security',
              title: 'hallucinated',
              explanation: 'e',
              severity: 'high',
              file_refs: ['src/nope.ts'],
            },
          ],
          review_focus: [],
        },
      },
    });
    const container = makeContainer({ llm, files: [{ path: 'src/real.ts', additions: 1, deletions: 0 }] });

    const result = await getOrComputeRiskBrief(container, 'ws-1', REPO, PULL, { force: false }, RUN_LOG);

    expect(result?.risks).toEqual([]);
    expect(result?.risk_level).toBe('low');
  });

  it('leaves any existing cache untouched and returns undefined when the LLM call fails (AC18)', async () => {
    const upsertPrBrief = vi.fn(async () => undefined);
    const throwingLlm = {
      id: 'openai' as const,
      calls: [] as unknown[],
      completeStructured: async (req: { schemaName: string; schema: { parse: (v: unknown) => unknown } }) => {
        if (req.schemaName === 'RiskBriefExtraction') throw new Error('provider down');
        return {
          data: req.schema.parse(DEFAULT_INTENT_FIXTURE),
          model: 'x',
          tokensIn: 1,
          tokensOut: 1,
          costUsd: null,
          raw: '{}',
          attempts: 1,
        };
      },
    };
    // force:true so the cache-read short-circuit is bypassed and the failing
    // compute actually runs (mirrors "Regenerate clicked" / the refresh path).
    const container = makeContainer({ llm: throwingLlm as never, upsertPrBrief });

    const result = await getOrComputeRiskBrief(container, 'ws-1', REPO, PULL, { force: true }, RUN_LOG);

    expect(result).toBeUndefined();
    expect(upsertPrBrief).not.toHaveBeenCalled();
  });

  it('never passes a traversal payload in Intent.plan_refs to readFile', async () => {
    const cachedIntent: Intent = {
      intent: 'cached intent',
      in_scope: [],
      out_of_scope: [],
      confidence: 0.9,
      source: 'spec',
      plan_refs: ['../../../../etc/passwd'],
    };
    const readFile = vi.fn(async () => {
      throw new Error('should never be called for a traversal payload');
    });
    const container = makeContainer({ getIntent: async () => cachedIntent, readFile });

    const result = await getOrComputeRiskBrief(container, 'ws-1', REPO, PULL, { force: false }, RUN_LOG);

    expect(readFile).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('degrades to a minimal brief (never throws) for a zero-changed-files PR', async () => {
    const container = makeContainer({});

    const result = await getOrComputeRiskBrief(container, 'ws-1', REPO, EMPTY_PULL, { force: false }, RUN_LOG);

    expect(result).toBeDefined();
    expect(result?.risks).toEqual([]);
    expect(result?.review_focus).toEqual([]);
    expect(result?.risk_level).toBe('low');
  });
});
