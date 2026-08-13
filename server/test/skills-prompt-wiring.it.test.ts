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

/**
 * The core fix (run-executor.ts resolving an agent's ENABLED, ORDERED linked
 * skills into `ReviewInput.skills`) verified end-to-end, with no LLM cost: a
 * mocked provider stands in, and the assertion is on the persisted run trace's
 * `prompt_assembly.skills` — the same field the trace UI renders as the
 * "Skills / rules" block. Covers the acceptance bar directly: "an enabled
 * skill shows as its own block in the logs, a disabled one doesn't."
 */
d('Skills → prompt assembly wiring (Testcontainers pg)', () => {
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

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: CLEAN_REVIEW }) },
      },
    });
  }

  async function setupRepoAndPr() {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `skills-wiring-${Date.now()}`, fullName: `acme/skills-wiring-${Date.now()}` })
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
    return pr!;
  }

  it('an enabled skill appears in the prompt-assembly trace; a disabled one does not', async () => {
    const app = await appWith();
    const pr = await setupRepoAndPr();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Wiring Test Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
      })
    ).json();

    const enabledSkill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'Enabled Rule', type: 'custom', body: 'ENABLED-SKILL-BODY-MARKER' },
      })
    ).json();
    const disabledSkill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'Disabled Rule',
          type: 'custom',
          body: 'DISABLED-SKILL-BODY-MARKER',
          enabled: false,
        },
      })
    ).json();

    // Link BOTH — the filter that matters is `skill.enabled`, not the link.
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [enabledSkill.id, disabledSkill.id] },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id;

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.skills).toContain('ENABLED-SKILL-BODY-MARKER');
    expect(trace.prompt_assembly.skills).toContain('Enabled Rule');
    expect(trace.prompt_assembly.skills).not.toContain('DISABLED-SKILL-BODY-MARKER');
    expect(trace.prompt_assembly.skills).not.toContain('Disabled Rule');

    // The user-message the model actually received also carries the block
    // (assemblePrompt renders `## Skills / rules` there), confirming the
    // enabled skill genuinely reached the prompt, not just the trace record.
    expect(trace.prompt_assembly.user).toContain('## Skills / rules');
    expect(trace.prompt_assembly.user).toContain('ENABLED-SKILL-BODY-MARKER');

    await app.close();
  });

  it('no linked skills (or all disabled) → the skills block is omitted entirely', async () => {
    const app = await appWith();
    const pr = await setupRepoAndPr();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'No Skills Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.skills).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Skills / rules');

    await app.close();
  });

  it('order matters: skills render in the agent-configured order', async () => {
    const app = await appWith();
    const pr = await setupRepoAndPr();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Ordered Skills Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
      })
    ).json();

    const first = (
      await app.inject({ method: 'POST', url: '/skills', payload: { name: 'First', type: 'custom', body: 'FIRST-BODY' } })
    ).json();
    const second = (
      await app.inject({ method: 'POST', url: '/skills', payload: { name: 'Second', type: 'custom', body: 'SECOND-BODY' } })
    ).json();

    // Link in reverse order — the block must follow THIS order, not creation order.
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [second.id, first.id] },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    const skillsBlock: string = trace.prompt_assembly.skills;
    expect(skillsBlock.indexOf('SECOND-BODY')).toBeLessThan(skillsBlock.indexOf('FIRST-BODY'));

    await app.close();
  });
});
