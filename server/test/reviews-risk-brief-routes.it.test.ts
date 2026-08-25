import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[reviews-risk-brief] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const INTENT_FIXTURE = {
  intent: 'Add rate limiting to protect the payments API from abuse.',
  in_scope: ['Add a token-bucket limiter middleware'],
  out_of_scope: ['Per-user quota configuration'],
};

const RISK_BRIEF_FIXTURE = {
  what: 'Adds a token-bucket rate limiter in front of the payments API.',
  why: 'Prevents abuse of the payments endpoint under load.',
  risks: [
    {
      kind: 'reliability',
      title: 'Limiter misconfiguration could block legitimate traffic',
      explanation: 'A too-tight bucket size may 429 real users during spikes.',
      severity: 'medium',
      file_refs: ['src/config.ts'],
    },
  ],
  review_focus: [
    { file: 'src/config.ts', line: 13, reason: 'New limiter config values live here.' },
  ],
};

/**
 * Trigger A/B route tests for the PR Why + Risk Brief (`GET /pulls/:id/brief`,
 * `POST /pulls/:id/brief/refresh` — Plan Step 5, `specs/03-pr-why-risk-brief-plan.md`).
 *
 * `getOrComputeRiskBrief` (`reviews/risk-brief.ts`) computes intent FIRST
 * (AC7-8) via `getOrComputeIntent`, whose model resolves via
 * `resolveFeatureModel(..., 'review_intent')` — registry default
 * `openrouter/deepseek-v4-flash` (per server/INSIGHTS.md 2026-08-18). `risk_brief`
 * itself defaults to `openai` (`platform.ts`), so these fixtures mock BOTH
 * providers — `openai` for the risk-brief extraction, `openrouter` for the
 * intent classification — rather than pointing `review_intent` at the mocked
 * `openai` provider via a settings override (either fix shape works; this one
 * needs no extra `PUT /settings` call per test).
 */
d('Reviews: PR risk brief routes (Testcontainers pg)', () => {
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

  function appWith(riskBriefLlm: MockLLMProvider, intentLlm: MockLLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: '' }),
        llm: { openai: riskBriefLlm, openrouter: intentLlm },
      },
    });
  }

  let repoSeq = 0;
  async function setupRepoAndPr(db: PgFixture['handle']['db'], opts: { body?: string } = {}) {
    const name = `payments-api-brief-${repoSeq++}`;
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
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: opts.body ?? null,
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return { repo: repo!, pr: pr! };
  }

  it('GET computes on first open (schema-valid, grounded PrRiskBrief) and reuses the cache on the next call', async () => {
    const riskBriefLlm = new MockLLMProvider('openai', {
      structuredBySchema: { RiskBriefExtraction: RISK_BRIEF_FIXTURE },
    });
    const intentLlm = new MockLLMProvider('openrouter', {
      structuredBySchema: { IntentExtraction: INTENT_FIXTURE },
    });
    const app = await appWith(riskBriefLlm, intentLlm);
    const { pr } = await setupRepoAndPr(pg.handle.db, {
      body: 'Adds a token-bucket rate limiter in front of the payments API. Closes #471.',
    });

    const first = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.pr_id).toBe(pr.id);
    expect(firstBody.head_sha).toBe(pr.headSha);
    expect(firstBody.what).toBe(RISK_BRIEF_FIXTURE.what);
    expect(firstBody.why).toBe(RISK_BRIEF_FIXTURE.why);
    // Grounded (in-changed-file-set) risk + focus item both survived intact —
    // no ungrounded reference in the response body.
    expect(firstBody.risks).toEqual(RISK_BRIEF_FIXTURE.risks);
    expect(firstBody.review_focus).toEqual(RISK_BRIEF_FIXTURE.review_focus);
    expect(firstBody.risk_level).toBe('medium');

    const riskCallsAfterFirst = riskBriefLlm.calls.filter((c) => c.method === 'completeStructured').length;
    expect(riskCallsAfterFirst).toBe(1);

    // Second GET reuses the persisted row — no additional LLM call at all
    // (neither risk-brief nor intent, since intent is also now cached).
    const second = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(firstBody);
    expect(riskBriefLlm.calls.filter((c) => c.method === 'completeStructured').length).toBe(
      riskCallsAfterFirst,
    );

    await app.close();
  });

  it('POST refresh forces a fresh computation even when a cached row exists', async () => {
    const riskBriefLlm = new MockLLMProvider('openai', {
      structuredBySchema: { RiskBriefExtraction: RISK_BRIEF_FIXTURE },
    });
    const intentLlm = new MockLLMProvider('openrouter', {
      structuredBySchema: { IntentExtraction: INTENT_FIXTURE },
    });
    const app = await appWith(riskBriefLlm, intentLlm);
    const { pr } = await setupRepoAndPr(pg.handle.db, {
      body: 'Adds a token-bucket rate limiter in front of the payments API.',
    });

    const first = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(first.statusCode).toBe(200);
    expect(riskBriefLlm.calls.filter((c) => c.method === 'completeStructured').length).toBe(1);

    const refreshed = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/refresh` });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().pr_id).toBe(pr.id);
    // Refresh always recomputes the brief itself, ignoring the cache.
    expect(riskBriefLlm.calls.filter((c) => c.method === 'completeStructured').length).toBe(2);

    await app.close();
  });

  it('POST refresh is rate-limited to 10/minute, matching POST /pulls/:id/intent/refresh', async () => {
    // `buildApp` disables @fastify/rate-limit entirely when
    // `config.nodeEnv === 'test'` (`src/app.ts`) — this test builds its own
    // app with the plugin enabled (NODE_ENV: 'production') to exercise the
    // real limit end-to-end, same workaround as the intent routes' test
    // (server/INSIGHTS.md 2026-08-18).
    const rateLimitedConfig = loadConfig({ ...process.env, NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    const riskBriefLlm = new MockLLMProvider('openai', {
      structuredBySchema: { RiskBriefExtraction: RISK_BRIEF_FIXTURE },
    });
    const intentLlm = new MockLLMProvider('openrouter', {
      structuredBySchema: { IntentExtraction: INTENT_FIXTURE },
    });
    const app = await buildApp({
      config: rateLimitedConfig,
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: '' }),
        llm: { openai: riskBriefLlm, openrouter: intentLlm },
      },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, {
      body: 'Adds a token-bucket rate limiter in front of the payments API.',
    });

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/refresh` });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 10)).toEqual(new Array(10).fill(200));
    expect(statuses[10]).toBe(429);

    await app.close();
  });

  it('GET on an unknown PR id returns 404', async () => {
    const riskBriefLlm = new MockLLMProvider('openai', {
      structuredBySchema: { RiskBriefExtraction: RISK_BRIEF_FIXTURE },
    });
    const intentLlm = new MockLLMProvider('openrouter', {
      structuredBySchema: { IntentExtraction: INTENT_FIXTURE },
    });
    const app = await appWith(riskBriefLlm, intentLlm);

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/00000000-0000-0000-0000-000000000000/brief`,
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
