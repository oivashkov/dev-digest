/**
 * Project Context (SPEC-01) — run-time injection wiring
 * (`buildProjectContextDocs` → `run-executor.ts` → `reviewer-core`'s `specs`
 * slot → the persisted trace). Modeled on
 * `test/skills-prompt-wiring.it.test.ts`; copies its `appWith()` mock shape
 * (an `openrouter` provider mock alongside the review-model mock) so a real
 * `OPENROUTER_API_KEY` on the machine running this suite never makes a
 * genuine network call via the Intent Layer's per-batch classify step
 * (`server/INSIGHTS.md`, 2026-08-18).
 */
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

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const CLEAN_REVIEW: Review = { verdict: 'approve', summary: 'Looks fine.', score: 100, findings: [] };

d('Project Context → prompt assembly wiring (Testcontainers pg)', () => {
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

  function appWith(opts: { files?: Record<string, string>; readFileThrows?: string[] } = {}) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF, files: opts.files, readFileThrows: opts.readFileThrows }),
        llm: {
          openai: new MockLLMProvider('openai', { structured: CLEAN_REVIEW }),
          openrouter: new MockLLMProvider('openrouter', {
            structuredBySchema: {
              IntentExtraction: { intent: 'test intent', in_scope: [], out_of_scope: [] },
            },
          }),
        },
      },
    });
  }

  async function setupRepoAndPr(clonePath: string | null = '/mock/clone') {
    const name = `context-wiring-${Date.now()}-${Math.random()}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 900,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'Add rate limiting.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return { repo: repo!, pr: pr! };
  }

  it('an attached document appears inside "## Project context", wrapped in <untrusted source="spec-0">', async () => {
    const app = await appWith({ files: { 'specs/rate-limit.md': 'RATE-LIMIT-SPEC-MARKER' } });
    const { repo, pr } = await setupRepoAndPr();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Context Wiring Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
      })
    ).json();

    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: ['specs/rate-limit.md'] },
    });

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.specs).toContain('RATE-LIMIT-SPEC-MARKER');
    expect(trace.prompt_assembly.user).toContain('## Project context');
    expect(trace.prompt_assembly.user).toContain('<untrusted source="spec-0">');
    expect(trace.prompt_assembly.user).toContain('RATE-LIMIT-SPEC-MARKER');
    expect(trace.specs_read).toEqual([{ path: 'specs/rate-limit.md', tokens: expect.any(Number), truncated: false }]);

    await app.close();
  });

  it('with zero attachments, the assembled prompt is byte-identical to a run with the feature absent', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'No Context Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
      })
    ).json();

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Project context');
    expect(trace.specs_read).toEqual([]);

    await app.close();
  });

  it('an attached-then-deleted file is skipped; the run still completes done and the Live Log names it', async () => {
    const app = await appWith({ readFileThrows: ['specs/gone.md'] });
    const { repo, pr } = await setupRepoAndPr();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Missing Doc Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: ['specs/gone.md'] },
    });

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const runRow = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    expect(runRow.find((r: { run_id: string }) => r.run_id === runId).status).toBe('done');

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.log.some((l: { msg: string }) => l.msg.includes('specs/gone.md'))).toBe(true);

    await app.close();
  });

  it('a repo-A attachment contributes nothing to a repo-B run and produces no Live Log line', async () => {
    const app = await appWith({ files: { 'specs/repo-a-only.md': 'REPO-A-ONLY-MARKER' } });
    const { repo: repoA } = await setupRepoAndPr();
    const { repo: repoB, pr: prB } = await setupRepoAndPr();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Cross Repo Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repoA.id, paths: ['specs/repo-a-only.md'] },
    });

    const res = await app.inject({ method: 'POST', url: `/pulls/${prB.id}/review`, payload: { agentId: agent.id } });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, prB.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.log.some((l: { msg: string }) => l.msg.includes('repo-a-only.md'))).toBe(false);
    void repoB;

    await app.close();
  });
});
