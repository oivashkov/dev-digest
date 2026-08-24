/**
 * Whole-prompt token budget for the PR risk brief (SPEC-03 amendment,
 * AC25-35). Two layers:
 *
 * - `fitRiskBriefPromptToBudget` unit tests — the pure ladder in isolation,
 *   with a deterministic stub `Tokenizer` and hand-picked budgets. No
 *   `Container`, no LLM.
 * - `getOrComputeRiskBrief` integration tests — the real
 *   `RISK_BRIEF_PROMPT_TOKEN_BUDGET` (8,000 tokens), driven through the same
 *   hermetic stubbed-`Container` approach as `reviews-risk-brief.test.ts`,
 *   asserting on what `MockLLMProvider` actually captured and on the
 *   `RUN_LOG.info` trim-log line.
 */
import { describe, it, expect, vi } from 'vitest';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import {
  getOrComputeRiskBrief,
  fitRiskBriefPromptToBudget,
  type RiskBriefFitSections,
} from '../src/modules/reviews/risk-brief.js';
import type { Container } from '../src/platform/container.js';
import type { Tokenizer } from '../src/adapters/tokenizer/index.js';
import type { Intent, PrRiskBrief } from '@devdigest/shared';

// Deterministic, matches `approxTokens` (`ceil(text.length / 4)`) — same
// stub every hermetic test in this package uses for `container.tokenizer`.
const STUB_TOKENIZER: Tokenizer = { count: (t: string) => Math.ceil(t.length / 4) };

// ---------------------------------------------------------------------------
// fitRiskBriefPromptToBudget — pure unit tests
// ---------------------------------------------------------------------------

const baseSections = (overrides: Partial<RiskBriefFitSections> = {}): RiskBriefFitSections => ({
  title: 'Simplify the retry loop',
  description: 'A description long enough to count as meaningful signal.',
  files: [],
  pull: { filesCount: 0, additions: 0, deletions: 0 },
  planExcerpts: [],
  ...overrides,
});

describe('fitRiskBriefPromptToBudget', () => {
  it('leaves everything unchanged when already under budget (AC27)', () => {
    const sections = baseSections({
      files: [{ path: 'src/a.ts', additions: 3, deletions: 1 }],
      pull: { filesCount: 1, additions: 3, deletions: 1 },
      planExcerpts: [{ path: 'specs/plan.md', content: 'some excerpt content' }],
    });

    const fit = fitRiskBriefPromptToBudget(sections, STUB_TOKENIZER, 1_000_000);

    expect(fit.trimmed).toBe(false);
    expect(fit.tokens).toBe(fit.tokensBefore);
    expect(fit.input.title).toBe(sections.title);
    expect(fit.input.description).toBe(sections.description);
    expect(fit.input.diffStat).toContain('src/a.ts');
    expect(fit.input.planExcerpts).toEqual(sections.planExcerpts);
    expect(fit.report).toEqual({
      planExcerpts: { kept: 1, total: 1 },
      diffStatFiles: { kept: 1, total: 1 },
      blastSymbols: { kept: 0, total: 0 },
      ticketBodyDropped: false,
    });
  });

  it('drops plan/spec excerpts from the end before touching diff-stat rows, stopping as soon as it fits (AC28-31)', () => {
    const excerptContent = 'x'.repeat(2_000); // ~500 tokens each
    const sections = baseSections({
      files: [
        { path: 'src/a.ts', additions: 3, deletions: 1 },
        { path: 'src/b.ts', additions: 3, deletions: 1 },
      ],
      pull: { filesCount: 2, additions: 6, deletions: 2 },
      planExcerpts: [
        { path: 'specs/one.md', content: excerptContent },
        { path: 'specs/two.md', content: excerptContent },
        { path: 'specs/three.md', content: excerptContent },
      ],
    });

    // Just under the untrimmed total — forces exactly one excerpt to drop.
    const full = fitRiskBriefPromptToBudget(sections, STUB_TOKENIZER, Number.MAX_SAFE_INTEGER);
    const fit = fitRiskBriefPromptToBudget(sections, STUB_TOKENIZER, full.tokens - 1);

    expect(fit.trimmed).toBe(true);
    expect(fit.tokens).toBeLessThanOrEqual(full.tokens - 1);
    // Excerpts trimmed from the end (`three.md` first) before diff-stat rows
    // are touched at all.
    expect(fit.report.planExcerpts.kept).toBe(2);
    expect(fit.input.planExcerpts?.map((e) => e.path)).toEqual(['specs/one.md', 'specs/two.md']);
    expect(fit.report.diffStatFiles).toEqual({ kept: 2, total: 2 });
    expect(fit.input.diffStat).toContain('src/a.ts');
    expect(fit.input.diffStat).toContain('src/b.ts');
  });

  it('shrinks the last surviving excerpt, then drops it, once no other excerpt remains (AC31)', () => {
    const sections = baseSections({
      planExcerpts: [{ path: 'specs/only.md', content: 'y'.repeat(20_000) }],
    });

    // Small enough that even a single ~20,000-char excerpt cannot survive
    // untouched, but large enough that title/description alone fit.
    const fit = fitRiskBriefPromptToBudget(sections, STUB_TOKENIZER, 400);

    expect(fit.trimmed).toBe(true);
    expect(fit.input.title).toBe(sections.title);
    expect(fit.input.description).toBe(sections.description);
    // Either shrunk (via the char ladder) or dropped entirely — never left
    // at its original 20,000-char size.
    if (fit.input.planExcerpts) {
      expect(fit.input.planExcerpts[0]?.content.length).toBeLessThan(20_000);
    } else {
      expect(fit.report.planExcerpts.kept).toBe(0);
    }
  });

  it('re-renders diff-stat rows sorted by largest churn with a stable path tiebreak once excerpts are exhausted (AC32)', () => {
    // No plan excerpts — forces the fitter straight to diff-row trimming.
    // `tie-a`/`tie-b` share the same (lowest) churn to exercise the tiebreak.
    const files = [
      { path: 'src/high.ts', additions: 100, deletions: 0 },
      { path: 'src/mid.ts', additions: 50, deletions: 0 },
      { path: 'src/tie-b.ts', additions: 10, deletions: 0 },
      { path: 'src/tie-a.ts', additions: 10, deletions: 0 },
    ];
    const sections = baseSections({
      files,
      pull: { filesCount: 4, additions: 170, deletions: 0 },
    });

    const full = fitRiskBriefPromptToBudget(sections, STUB_TOKENIZER, Number.MAX_SAFE_INTEGER);
    // Just tight enough that only 3 of the 4 rows fit — the boundary lands
    // exactly at the tied pair.
    const fit = fitRiskBriefPromptToBudget(sections, STUB_TOKENIZER, full.tokens - 3);

    expect(fit.trimmed).toBe(true);
    expect(fit.report.diffStatFiles).toEqual({ kept: 3, total: 4 });
    // Both higher-churn files always survive; of the tied pair, only the
    // lexicographically-first path (`tie-a` < `tie-b`) survives.
    expect(fit.input.diffStat).toContain('src/high.ts');
    expect(fit.input.diffStat).toContain('src/mid.ts');
    expect(fit.input.diffStat).toContain('src/tie-a.ts');
    expect(fit.input.diffStat).not.toContain('src/tie-b.ts');
  });

  it('re-renders blast-radius symbols below the cap while keeping the status:/Endpoints: lines (AC28-30)', () => {
    const symbols = Array.from({ length: 5 }, (_, i) => ({
      name: `sym${i}`,
      file: `src/s${i}.ts`,
      kind: 'function',
      callers: [],
      endpoints: [],
      crons: [],
      callers_truncated: false,
    }));
    const blast = {
      pr_id: 'p',
      repo_id: 'r',
      symbols,
      impacted_endpoints: ['GET /a'],
      impacted_crons: [],
      counts: { symbols: 5, callers: 0, endpoints: 1, crons: 0 },
      status: 'full' as const,
      reason: null,
    };
    const sections = baseSections({ blast });

    const full = fitRiskBriefPromptToBudget(sections, STUB_TOKENIZER, Number.MAX_SAFE_INTEGER);
    const fit = fitRiskBriefPromptToBudget(sections, STUB_TOKENIZER, full.tokens - 1);

    expect(fit.trimmed).toBe(true);
    expect(fit.report.blastSymbols).toEqual({ kept: 4, total: 5 });
    expect(fit.input.blastSummary).toContain('status: full');
    expect(fit.input.blastSummary).toContain('Endpoints: GET /a');
    expect(fit.input.blastSummary).not.toContain('sym4');
  });

  it('title and description survive even at an absurdly small budget (AC33)', () => {
    const sections = baseSections({
      files: Array.from({ length: 20 }, (_, i) => ({ path: `src/f${i}.ts`, additions: 5, deletions: 1 })),
      pull: { filesCount: 20, additions: 100, deletions: 20 },
      planExcerpts: [{ path: 'specs/plan.md', content: 'z'.repeat(20_000) }],
      ticket: { title: 'TICKET-1', body: 'a'.repeat(5_000) },
    });

    const fit = fitRiskBriefPromptToBudget(sections, STUB_TOKENIZER, 1);

    expect(fit.input.title).toBe(sections.title);
    expect(fit.input.description).toBe(sections.description);
    // Everything trimmable is trimmed all the way down.
    expect(fit.report.planExcerpts.kept).toBe(0);
    expect(fit.report.ticketBodyDropped).toBe(true);
    expect(fit.input.ticket).toEqual({ title: 'TICKET-1' });
  });

  it('drops the ticket body but never the ticket title, once excerpts/diff-rows/blast-symbols are exhausted (AC28 decision, "f")', () => {
    const sections = baseSections({
      files: [],
      pull: { filesCount: 0, additions: 0, deletions: 0 },
      planExcerpts: [],
      ticket: { title: 'TICKET-42', body: 'body '.repeat(2_000) },
    });

    const full = fitRiskBriefPromptToBudget(sections, STUB_TOKENIZER, Number.MAX_SAFE_INTEGER);
    const fit = fitRiskBriefPromptToBudget(sections, STUB_TOKENIZER, full.tokens - 10);

    expect(fit.trimmed).toBe(true);
    expect(fit.report.ticketBodyDropped).toBe(true);
    expect(fit.input.ticket).toEqual({ title: 'TICKET-42' });
  });
});

// ---------------------------------------------------------------------------
// getOrComputeRiskBrief — integration, real RISK_BRIEF_PROMPT_TOKEN_BUDGET
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
  llm?: MockLLMProvider;
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
    tokenizer: STUB_TOKENIZER,
  } as unknown as Container;
}

describe('getOrComputeRiskBrief — prompt token budget', () => {
  it('a normal-size PR fits under budget: no trim log, exactly one RiskBriefExtraction call (AC27)', async () => {
    RUN_LOG.info.mockClear();
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        IntentExtraction: DEFAULT_INTENT_FIXTURE,
        RiskBriefExtraction: DEFAULT_BRIEF_FIXTURE,
      },
    });
    const container = makeContainer({
      llm,
      files: [{ path: 'src/real.ts', additions: 5, deletions: 1 }],
    });

    const result = await getOrComputeRiskBrief(container, 'ws-1', REPO, PULL, { force: false }, RUN_LOG);

    expect(result).toBeDefined();
    const briefCalls = llm.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'RiskBriefExtraction',
    );
    expect(briefCalls).toHaveLength(1);
    const trimLogs = RUN_LOG.info.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('prompt trimmed'),
    );
    expect(trimLogs).toHaveLength(0);
  });

  it('degrades to undefined without calling the LLM or writing the cache when the prompt cannot fit even after full trim (AC34)', async () => {
    const upsertPrBrief = vi.fn(async () => undefined);
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        IntentExtraction: DEFAULT_INTENT_FIXTURE,
        RiskBriefExtraction: DEFAULT_BRIEF_FIXTURE,
      },
    });
    // Title + description alone (never trimmed) exceed the 8,000-token
    // budget by construction — ~10,000 tokens from these two fields alone
    // under the `ceil(len/4)` stub.
    const hugePull = {
      ...PULL,
      title: 'T'.repeat(20_000),
      body: 'D'.repeat(20_000),
    } as never;
    const container = makeContainer({ llm, upsertPrBrief });

    // force:true bypasses the cache-read short-circuit so the failing
    // compute actually runs (mirrors the existing AC18 test's approach).
    const result = await getOrComputeRiskBrief(container, 'ws-1', REPO, hugePull, { force: true }, RUN_LOG);

    expect(result).toBeUndefined();
    expect(upsertPrBrief).not.toHaveBeenCalled();
    const briefCalls = llm.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'RiskBriefExtraction',
    );
    expect(briefCalls).toHaveLength(0);
  });

  it('emits a single trim log with per-section kept/total and before→after token counts when trimming is applied (AC35)', async () => {
    RUN_LOG.info.mockClear();
    const bigExcerpt = 'p'.repeat(15_000);
    const cachedIntent: Intent = {
      intent: 'Simplify retry logic',
      in_scope: [],
      out_of_scope: [],
      confidence: 0.9,
      source: 'spec',
      plan_refs: ['specs/one.md', 'specs/two.md', 'specs/three.md', 'specs/four.md'],
    };
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        IntentExtraction: DEFAULT_INTENT_FIXTURE,
        RiskBriefExtraction: DEFAULT_BRIEF_FIXTURE,
      },
    });
    const container = makeContainer({
      llm,
      getIntent: async () => cachedIntent,
      readFile: async () => bigExcerpt,
      files: [{ path: 'src/real.ts', additions: 5, deletions: 1 }],
    });

    const result = await getOrComputeRiskBrief(container, 'ws-1', REPO, PULL, { force: false }, RUN_LOG);

    expect(result).toBeDefined();
    const trimCall = RUN_LOG.info.mock.calls.find((c: unknown[]) => String(c[0]).includes('prompt trimmed'));
    expect(trimCall).toBeDefined();
    const msg = String(trimCall?.[0]);
    expect(msg).toMatch(/plan excerpts \d+\/4/);
    expect(msg).toMatch(/diff rows \d+\/\d+/);
    expect(msg).toMatch(/blast symbols \d+\/\d+/);
    expect(msg).toMatch(/\d+→\d+ tokens \(budget 8000\)/);
    // At least one excerpt must have been dropped to fit — 4 originally.
    const kept = Number(/plan excerpts (\d+)\/4/.exec(msg)?.[1]);
    expect(kept).toBeLessThan(4);
  });

  it('regression: a file trimmed out of the in-prompt diff stat is still accepted by grounding (allowlist stays untrimmed)', async () => {
    // 30 files with a very long shared path prefix so the untrimmed
    // diff-stat block alone blows past the 8,000-token budget, forcing
    // diff-row trimming even with no plan excerpts or ticket in play.
    const longPrefix = 'x'.repeat(1_500);
    const files = Array.from({ length: 30 }, (_, i) => ({
      path: `${longPrefix}/file-${String(i).padStart(2, '0')}.ts`,
      additions: i === 0 ? 1 : 30 - i, // file-00 has the lowest churn — first to drop
      deletions: 0,
    }));
    const droppedPath = files[0]!.path; // lowest churn -> dropped from the rendered diff-stat first

    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        IntentExtraction: DEFAULT_INTENT_FIXTURE,
        RiskBriefExtraction: {
          what: 'what',
          why: 'why',
          risks: [
            {
              kind: 'security',
              title: 'cites a file dropped from the trimmed prompt',
              explanation: 'still a real changed file',
              severity: 'medium',
              file_refs: [droppedPath],
            },
          ],
          review_focus: [],
        },
      },
    });
    const container = makeContainer({ llm, files });

    const result = await getOrComputeRiskBrief(container, 'ws-1', REPO, PULL, { force: false }, RUN_LOG);

    // Grounding still accepts the citation — the allowlist is built from the
    // full `files` set, never the truncated in-prompt diff-stat subset.
    expect(result?.risks).toEqual([expect.objectContaining({ file_refs: [droppedPath] })]);

    // And confirm the file really was dropped from what was actually sent.
    const briefCall = llm.calls.find(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'RiskBriefExtraction',
    );
    const sentMessages = (briefCall?.req as { messages: { role: string; content: string }[] }).messages;
    const userMessage = sentMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).not.toContain(droppedPath);
  });
});
