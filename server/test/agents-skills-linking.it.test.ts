import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/**
 * `POST /agents/:id/skills` (the "set the full skill_ids array" path used by
 * the Skills tab's attach/detach/reorder checkboxes) — the delete-then-insert
 * that replaces `agent_skills` used to run as two unwrapped statements, so
 * two overlapping calls for the same agent (or a caller-side duplicate id)
 * could 500 with a raw `duplicate key value violates unique constraint
 * "agent_skills_agent_id_skill_id_pk"`. Now wrapped in one transaction +
 * defensively deduplicated.
 */
d('POST /agents/:id/skills — concurrency + duplicate-id safety', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  async function setup() {
    const app = await makeApp();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Link Test ${Date.now()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();
    const skillA = (
      await app.inject({ method: 'POST', url: '/skills', payload: { name: `A ${Date.now()}`, type: 'custom', body: 'a' } })
    ).json();
    const skillB = (
      await app.inject({ method: 'POST', url: '/skills', payload: { name: `B ${Date.now()}`, type: 'custom', body: 'b' } })
    ).json();
    return { app, agentId: agent.id as string, skillA: skillA.id as string, skillB: skillB.id as string };
  }

  it('a duplicated id in skill_ids does not 500 — deduplicated instead', async () => {
    const { app, agentId, skillA } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillA, skillA] },
    });
    expect(res.statusCode).toBe(200);

    const links = (await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` })).json();
    expect(links).toHaveLength(1);
    expect(links[0].skill_id).toBe(skillA);
    await app.close();
  });

  it('two overlapping full-replace calls for the same agent both succeed (no 500)', async () => {
    const { app, agentId, skillA, skillB } = await setup();

    // Fired concurrently — this is what Strict Mode's double-invoked updater
    // (or two tabs) produces: two POSTs for the same agent, in flight together.
    const [r1, r2] = await Promise.all([
      app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_ids: [skillA, skillB] } }),
      app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_ids: [skillA, skillB] } }),
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);

    // Whichever ran last, the end state is exactly the two links — no
    // duplicate rows, no crash, no partial/leftover state from the race.
    const links = (await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` })).json();
    expect(links.map((l: { skill_id: string }) => l.skill_id).sort()).toEqual([skillA, skillB].sort());
    await app.close();
  });
});
