import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * Conventions routes against a real DB. The seeded demo repo has no clone
 * path, so `POST .../extract` exercises the degrade-gracefully path (job
 * completes with nothing written, never crashes) — the LLM-writes-candidates
 * path is covered hermetically in conventions-extraction.test.ts.
 */
d('Conventions module', () => {
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

  async function demoRepoId(): Promise<string> {
    const [row] = await pg.handle.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    return row!.id;
  }

  it('GET /repos/:id/conventions starts empty/idle', async () => {
    const app = await makeApp();
    const repoId = await demoRepoId();

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ candidates: [], scan_status: 'idle', last_scan_at: null });
    await app.close();
  });

  it('POST /repos/:id/conventions/extract degrades gracefully when the repo has no clone yet', async () => {
    const app = await makeApp();
    const repoId = await demoRepoId();

    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'accepted' });

    await app.container.jobs.onIdle();

    const after = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(after.json()).toMatchObject({ candidates: [], scan_status: 'idle' });
    await app.close();
  });

  it('PATCH /conventions/:id accepts, rejects, and edits a candidate', async () => {
    const app = await makeApp();
    const repoId = await demoRepoId();
    const [{ workspaceId }] = await pg.handle.db
      .select({ workspaceId: t.repos.workspaceId })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));

    const [row] = await pg.handle.db
      .insert(t.conventions)
      .values({
        workspaceId: workspaceId!,
        repoId,
        category: 'naming',
        rule: 'Use camelCase for helper functions',
        evidencePath: 'src/lib/helpers.ts',
        evidenceLineRange: '4-6',
        evidenceSnippet: 'function getUser() {}',
        confidence: 0.7,
      })
      .returning();

    const accept = await app.inject({
      method: 'PATCH',
      url: `/conventions/${row!.id}`,
      payload: { accepted: true },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json()).toMatchObject({ accepted: true, rule: row!.rule });

    const edited = await app.inject({
      method: 'PATCH',
      url: `/conventions/${row!.id}`,
      payload: { rule: 'Use camelCase for every helper function' },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ rule: 'Use camelCase for every helper function', accepted: true });

    const rejected = await app.inject({
      method: 'PATCH',
      url: `/conventions/${row!.id}`,
      payload: { accepted: false },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({ accepted: false });
    await app.close();
  });

  it('404s PATCHing an unknown candidate', async () => {
    const app = await makeApp();
    const ghost = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method: 'PATCH',
      url: `/conventions/${ghost}`,
      payload: { accepted: true },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('conventions are workspace-scoped: another tenant cannot PATCH them', async () => {
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-conventions' }).returning();
    const repoId = await demoRepoId();
    const [{ workspaceId }] = await db
      .select({ workspaceId: t.repos.workspaceId })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));

    const [foreign] = await db
      .insert(t.conventions)
      .values({
        workspaceId: otherWs!.id,
        repoId: null,
        category: 'other',
        rule: 'Foreign convention',
        confidence: 0.5,
      })
      .returning();
    expect(
      await db
        .select()
        .from(t.conventions)
        .where(and(eq(t.conventions.id, foreign!.id), eq(t.conventions.workspaceId, workspaceId!))),
    ).toEqual([]);

    const app = await makeApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/conventions/${foreign!.id}`,
      payload: { accepted: true },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
