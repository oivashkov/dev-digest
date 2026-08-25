/**
 * Project Context (SPEC-01) — attach/detach on agents and skills
 * (`PUT/GET /agents/:id/context`, `PUT/GET /skills/:id/context`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function insertRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `context-attach-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: null })
    .returning();
  return repo!;
}

d('Project Context attach routes (Testcontainers pg)', () => {
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

  function app() {
    return buildApp({ config: config(), db: pg.handle.db, overrides: { embedder: new MockEmbedder() } });
  }

  async function createAgent(a: Awaited<ReturnType<typeof app>>) {
    const res = await a.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Context Test ${Date.now()}-${Math.random()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
    });
    return res.json().id as string;
  }

  async function createSkill(a: Awaited<ReturnType<typeof app>>) {
    const res = await a.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: `Context Skill ${Date.now()}-${Math.random()}`, type: 'custom', body: 'x' },
    });
    return res.json().id as string;
  }

  it('agent: attach → read back in order', async () => {
    const a = await app();
    const agentId = await createAgent(a);
    const repo = await insertRepo(pg.handle.db, workspaceId);

    const put = await a.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context`,
      payload: { repo_id: repo.id, paths: ['docs/b.md', 'specs/a.md'] },
    });
    expect(put.statusCode).toBe(200);
    const putBody = put.json();
    expect(putBody.map((d: { path: string }) => d.path)).toEqual(['docs/b.md', 'specs/a.md']);
    expect(putBody.every((d: { missing: boolean }) => d.missing === true)).toBe(true); // no clone → nothing discovered

    const get = await a.inject({ method: 'GET', url: `/agents/${agentId}/context?repo_id=${repo.id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json().map((d: { path: string; order: number }) => [d.path, d.order])).toEqual([
      ['docs/b.md', 0],
      ['specs/a.md', 1],
    ]);
    await a.close();
  });

  it('agent: a traversal path is rejected 422 before the handler runs', async () => {
    const a = await app();
    const agentId = await createAgent(a);
    const repo = await insertRepo(pg.handle.db, workspaceId);

    const res = await a.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context`,
      payload: { repo_id: repo.id, paths: ['../etc/passwd'] },
    });
    expect(res.statusCode).toBe(422);
    await a.close();
  });

  it('agent: two concurrent PUTs for a fresh agent both succeed (no 500)', async () => {
    const a = await app();
    const agentId = await createAgent(a);
    const repo = await insertRepo(pg.handle.db, workspaceId);

    const [r1, r2] = await Promise.all([
      a.inject({
        method: 'PUT',
        url: `/agents/${agentId}/context`,
        payload: { repo_id: repo.id, paths: ['specs/a.md', 'docs/b.md'] },
      }),
      a.inject({
        method: 'PUT',
        url: `/agents/${agentId}/context`,
        payload: { repo_id: repo.id, paths: ['specs/a.md', 'docs/b.md'] },
      }),
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);

    const get = await a.inject({ method: 'GET', url: `/agents/${agentId}/context?repo_id=${repo.id}` });
    expect(get.json().map((dd: { path: string }) => dd.path).sort()).toEqual(['docs/b.md', 'specs/a.md']);
    await a.close();
  });

  it('agent: an attachment made against repo A is absent from the same agent read against repo B', async () => {
    const a = await app();
    const agentId = await createAgent(a);
    const repoA = await insertRepo(pg.handle.db, workspaceId);
    const repoB = await insertRepo(pg.handle.db, workspaceId);

    await a.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context`,
      payload: { repo_id: repoA.id, paths: ['specs/only-in-a.md'] },
    });

    const getB = await a.inject({ method: 'GET', url: `/agents/${agentId}/context?repo_id=${repoB.id}` });
    expect(getB.json()).toEqual([]);
    await a.close();
  });

  it('agent: a new version snapshot contains context_docs', async () => {
    const a = await app();
    const agentId = await createAgent(a);
    const repo = await insertRepo(pg.handle.db, workspaceId);

    await a.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context`,
      payload: { repo_id: repo.id, paths: ['specs/a.md'] },
    });
    // Attaching context docs alone doesn't bump the version — trigger a real
    // config change so a new snapshot is taken.
    await a.inject({
      method: 'PUT',
      url: `/agents/${agentId}`,
      payload: { system_prompt: 'A different system prompt.' },
    });

    const versions = await a.inject({ method: 'GET', url: `/agents/${agentId}/versions` });
    const latest = versions.json()[0];
    expect(latest.config.context_docs).toEqual(['specs/a.md']);
    await a.close();
  });

  it('skill: attach persists and is readable, ordered by normalized path', async () => {
    const a = await app();
    const skillId = await createSkill(a);
    const repo = await insertRepo(pg.handle.db, workspaceId);

    const put = await a.inject({
      method: 'PUT',
      url: `/skills/${skillId}/context`,
      payload: { repo_id: repo.id, paths: ['specs/b.md', 'docs/a.md'] },
    });
    expect(put.statusCode).toBe(200);

    const get = await a.inject({ method: 'GET', url: `/skills/${skillId}/context?repo_id=${repo.id}` });
    expect(get.json().map((dd: { path: string }) => dd.path)).toEqual(['docs/a.md', 'specs/b.md']);
    await a.close();
  });
});
