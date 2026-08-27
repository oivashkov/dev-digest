import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-restore-version] Docker not available — skipping integration tests.');
}

/**
 * `POST /agents/:id/versions/:version/restore` — SPEC-04 "Promote prompt &
 * model vN" (ACs 56-59). Composes `getVersion()` + `update()`: restores only
 * the seven config fields `update()` accepts, leaves linked skills as they
 * stand, and lands as a NEW version rather than mutating history.
 */
d('POST /agents/:id/versions/:version/restore', () => {
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

  const createBody = {
    name: 'Restorable Agent',
    provider: 'openai' as const,
    model: 'gpt-4o-mini',
    system_prompt: 'Review the diff for v1.',
  };

  it('restores v1 config after a v2 edit, landing as a NEW v3 — no historical row mutated', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;

    // v2: a config-affecting edit.
    const v2 = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}`,
      payload: { model: 'gpt-4o', system_prompt: 'Review the diff for v2.' },
    });
    expect(v2.statusCode).toBe(200);
    expect(v2.json().version).toBe(2);

    // Promote v1 back onto the live agent.
    const restore = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/versions/1/restore`,
    });
    expect(restore.statusCode).toBe(200);
    const restored = restore.json();
    expect(restored.model).toBe('gpt-4o-mini');
    expect(restored.system_prompt).toBe('Review the diff for v1.');
    // Greater than the previously-current version (2), not equal to the
    // version being restored (1) — a NEW snapshot, not a rewind (AC 57).
    expect(restored.version).toBe(3);

    const versions = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` })
    ).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    // v1 and v2's own snapshots are untouched by the promote.
    expect(versions[2]).toMatchObject({ version: 1, config: { model: 'gpt-4o-mini' } });
    expect(versions[1]).toMatchObject({ version: 2, config: { model: 'gpt-4o' } });
    expect(versions[0]).toMatchObject({ version: 3, config: { model: 'gpt-4o-mini' } });

    await app.close();
  });

  it('restores only the seven config fields — linked skills are left untouched', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `Restore-test skill ${Date.now()}`, type: 'custom', body: 'x' },
      })
    ).json();

    // v1 has no linked skills. Link one now (does not itself bump version —
    // skills are not part of isConfigChange), then make a config edit (v2).
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skill.id] },
    });
    await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}`,
      payload: { model: 'gpt-4o' },
    });

    const beforeRestore = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` })
    ).json();
    expect(beforeRestore).toHaveLength(1);

    const restore = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/versions/1/restore`,
    });
    expect(restore.statusCode).toBe(200);
    expect(restore.json().model).toBe('gpt-4o-mini');

    // The live skill link — set independently of any agent_versions
    // snapshot — is unaffected by a config-only restore.
    const afterRestore = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` })
    ).json();
    expect(afterRestore).toHaveLength(1);
    expect(afterRestore[0].skill_id).toBe(skill.id);

    await app.close();
  });

  it('404s for an unknown version and for another workspace\'s agent', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;

    const unknownVersion = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/versions/99/restore`,
    });
    expect(unknownVersion.statusCode).toBe(404);

    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-restore' }).returning();
    const repo = new AgentsRepository(db);
    const foreign = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign Restorable',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });
    // Give the foreign agent a v2 so v1 genuinely exists to restore.
    await repo.update(otherWs!.id, foreign.id, { model: 'gpt-4o' });

    // Default-workspace request context (no workspace override) cannot
    // restore a version belonging to a different workspace's agent.
    const crossWorkspace = await app.inject({
      method: 'POST',
      url: `/agents/${foreign.id}/versions/1/restore`,
    });
    expect(crossWorkspace.statusCode).toBe(404);

    // Sanity: the foreign agent's config is untouched by the rejected call.
    const [row] = await db.select().from(t.agents).where(eq(t.agents.id, foreign.id));
    expect(row!.model).toBe('gpt-4o');

    await app.close();
  });
});
