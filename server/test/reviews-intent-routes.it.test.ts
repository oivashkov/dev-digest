import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const INTENT_FIXTURE = {
  intent: 'Add rate limiting to protect the payments API from abuse.',
  in_scope: ['Add a token-bucket limiter middleware'],
  out_of_scope: ['Per-user quota configuration'],
};

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const CLEAN_REVIEW: Review = { verdict: 'approve', summary: 'Looks fine.', score: 100, findings: [] };

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { body?: string; withPrFile?: boolean } = {},
) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: opts.withPrFile ? 1 : 0,
      deletions: 0,
      filesCount: opts.withPrFile ? 1 : 0,
      status: 'needs_review',
      body: opts.body ?? null,
    })
    .returning();
  if (opts.withPrFile) {
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
  }
  return { repo: repo!, pr: pr! };
}

/**
 * Trigger A/B route tests (`GET /pulls/:id/intent`, `POST
 * /pulls/:id/intent/refresh` — Step 5, `docs/plans/intent-layer.md`).
 *
 * Per `server/INSIGHTS.md` (2026-08-18, "Any *.it.test.ts that POSTs
 * /pulls/:id/review..."), `getOrComputeIntent` resolves its model via
 * `resolveFeatureModel(..., 'review_intent')`, whose registry default is
 * `openrouter/deepseek-v4-flash` — a provider these fixtures never mock. To
 * stay hermetic, every test here first points the workspace's `review_intent`
 * feature model at the mocked `openai` provider via `PUT /settings`.
 */
d('Reviews: PR intent routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(llm: MockLLMProvider, diff = '') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff }),
        llm: { openai: llm },
      },
    });
  }

  async function pointReviewIntentAtMockOpenAi(app: Awaited<ReturnType<typeof appWith>>) {
    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { review_intent: { provider: 'openai', model: 'gpt-4.1' } } },
    });
    expect(put.statusCode).toBe(200);
  }

  it('GET computes on first open and reuses the cache on the next call', async () => {
    const llm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
    const app = await appWith(llm);
    await pointReviewIntentAtMockOpenAi(app);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, {
      body: 'Adds a token-bucket rate limiter in front of the payments API. Closes #471. See docs/plans/rate-limit.md for the design.',
    });

    const first = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.pr_id).toBe(pr.id);
    expect(firstBody.intent).toBe(INTENT_FIXTURE.intent);
    expect(firstBody.confidence).toBeGreaterThan(0);
    const callsAfterFirst = llm.calls.filter((c) => c.method === 'completeStructured').length;
    expect(callsAfterFirst).toBe(1);

    // Second GET reuses the persisted row — no second LLM call.
    const second = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(firstBody);
    const callsAfterSecond = llm.calls.filter((c) => c.method === 'completeStructured').length;
    expect(callsAfterSecond).toBe(1);

    await app.close();
  });

  it('GET on a PR with no signals still returns a low-confidence, inferred record', async () => {
    const llm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
    const app = await appWith(llm);
    await pointReviewIntentAtMockOpenAi(app);
    // No body, no files, no diff — nothing but a title. classifyIntent still
    // runs (title alone is enough for a call); tierFor degrades to 'inferred'.
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe('inferred');
    expect(body.confidence).toBeLessThan(0.5);

    await app.close();
  });

  it('POST refresh forces a fresh computation even when a cached row exists', async () => {
    const llm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
    const app = await appWith(llm);
    await pointReviewIntentAtMockOpenAi(app);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, {
      body: 'Adds a token-bucket rate limiter in front of the payments API.',
    });

    const first = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(first.statusCode).toBe(200);
    expect(llm.calls.filter((c) => c.method === 'completeStructured').length).toBe(1);

    const refreshed = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent/refresh` });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().pr_id).toBe(pr.id);
    // Refresh always recomputes, ignoring the cache — a second LLM call happened.
    expect(llm.calls.filter((c) => c.method === 'completeStructured').length).toBe(2);

    await app.close();
  });

  it('POST refresh is rate-limited to 10/minute, matching POST /pulls/:id/review', async () => {
    // `buildApp` disables the @fastify/rate-limit plugin entirely when
    // `config.nodeEnv === 'test'` (`src/app.ts`: "Disabled under test so
    // integration suites can hammer endpoints via inject()") — the default
    // `config()` helper in this file always sets NODE_ENV to 'test', so the
    // route's per-route `config: { rateLimit: {...} } }` would never actually
    // engage against it. This one test builds its own app with the plugin
    // enabled (NODE_ENV: 'production') to exercise the real limit end-to-end.
    const rateLimitedConfig = loadConfig({
      ...process.env,
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv);
    const llm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
    const app = await buildApp({
      config: rateLimitedConfig,
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: '' }),
        llm: { openai: llm },
      },
    });
    await pointReviewIntentAtMockOpenAi(app);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, {
      body: 'Adds a token-bucket rate limiter in front of the payments API.',
    });

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent/refresh` });
      statuses.push(res.statusCode);
    }
    // First 10 calls within the window succeed, the 11th is rejected by the
    // route's `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`
    // (server/src/modules/reviews/routes.ts) — same limit as POST /pulls/:id/review.
    expect(statuses.slice(0, 10)).toEqual(new Array(10).fill(200));
    expect(statuses[10]).toBe(429);

    await app.close();
  });

  /**
   * End-to-end coverage for the full `run-executor.ts` → `reviewPullRequest`
   * → `assemblePrompt` chain (Step 3+4, `docs/plans/intent-layer.md`): a PR
   * intent computed and cached via trigger A (`GET /pulls/:id/intent`) must
   * be reused — not recomputed — by trigger C (`POST /pulls/:id/review`),
   * and must actually render as the `## PR intent` section in the review
   * prompt, visible on the persisted run trace's `prompt_assembly` field.
   */
  it('a review run reuses the cached intent and renders it as the "## PR intent" prompt section', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        IntentExtraction: INTENT_FIXTURE,
        Review: CLEAN_REVIEW,
      },
    });
    const app = await appWith(llm, DIFF);
    await pointReviewIntentAtMockOpenAi(app);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, {
      body: 'Adds a token-bucket rate limiter in front of the payments API. Closes #471.',
      withPrFile: true,
    });

    // Trigger A: open the PR detail view — computes and caches the intent.
    const getRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(getRes.statusCode).toBe(200);
    expect(llm.calls.filter((c) => c.method === 'completeStructured').length).toBe(1);

    // Trigger C: run the review. The cached intent must be reused, not
    // recomputed — the completeStructured call count for classification
    // stays at 1; only a new 'Review'-schema call is added.
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Intent Prompt Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
      })
    ).json();
    const runRes = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(runRes.statusCode).toBe(200);
    const runId = runRes.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const calls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(calls).toHaveLength(2);
    expect((calls[0]!.req as { schemaName: string }).schemaName).toBe('IntentExtraction');
    expect((calls[1]!.req as { schemaName: string }).schemaName).toBe('Review');

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.pr_intent).toBe(INTENT_FIXTURE.intent);
    expect(trace.prompt_assembly.user).toContain('## PR intent');
    expect(trace.prompt_assembly.user).toContain(INTENT_FIXTURE.intent);

    await app.close();
  });
});
