import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockGitLabClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integration] Docker not available — skipping Testcontainers integration tests.',
  );
}

d('Testcontainers: pg + pgvector', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('migrations applied: every table exists', async () => {
    const rows = await pg.handle.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM information_schema.tables
      WHERE table_schema = 'public'`;
    // 35 domain tables + drizzle migration bookkeeping
    expect(rows[0]!.count).toBeGreaterThanOrEqual(35);
  });

  it('pgvector extension is enabled', async () => {
    const rows = await pg.handle.sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    expect(rows).toHaveLength(1);
  });

  it('vector insert + similarity query round-trips', async () => {
    const { db } = pg.handle;
    const { workspaceId } = await seed(db);
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'v', name: 'vec', fullName: 'v/vec' })
      .returning();
    const vec = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
    await db.insert(t.codeChunks).values({
      workspaceId,
      repoId: repo!.id,
      path: 'a.ts',
      content: 'hello',
      embedding: vec,
      source: 'code',
    });
    // cosine distance query against the same vector → distance ~0
    const literal = `[${vec.join(',')}]`;
    const rows = await pg.handle.sql<{ dist: number }[]>`
      SELECT embedding <=> ${literal}::vector AS dist
      FROM code_chunks WHERE repo_id = ${repo!.id}`;
    expect(rows[0]!.dist).toBeLessThan(0.0001);
  });

  it('seed is idempotent (re-run does not duplicate workspace)', async () => {
    await seed(pg.handle.db);
    await seed(pg.handle.db);
    const ws = await pg.handle.db.select().from(t.workspaces);
    expect(ws.filter((w) => w.name === 'default')).toHaveLength(1);
  });
});

d('Testcontainers: DB-backed routes via app.inject', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('POST /repos persists + enqueues a clone (mock git) and GET /repos lists it', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const git = new MockGitClient();
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git, github: new MockGitHubClient() },
    });

    const create = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/widgets' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().full_name).toBe('acme/widgets');

    await app.container.jobs.onIdle();
    expect(git.cloned.some((c) => c.repo.name === 'widgets')).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/repos' });
    expect(list.json().some((r: { full_name: string }) => r.full_name === 'acme/widgets')).toBe(
      true,
    );
    await app.close();
  });

  it('POST /repos on a github.com URL defaults provider/host; a gitlab.com URL persists provider="gitlab" and routes to the GitLab client', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const gitlab = new MockGitLabClient();
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient(), gitlab },
    });

    const ghCreate = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/gh-repo' },
    });
    expect(ghCreate.statusCode).toBe(201);
    expect(ghCreate.json().provider).toBe('github');
    expect(ghCreate.json().host).toBe('github.com');
    expect(ghCreate.json().insecure_tls).toBe(false);

    const glCreate = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://gitlab.com/acme/gl-repo' },
    });
    expect(glCreate.statusCode).toBe(201);
    expect(glCreate.json().provider).toBe('gitlab');
    expect(glCreate.json().host).toBe('gitlab.com');
    expect(glCreate.json().insecure_tls).toBe(false);

    await app.container.jobs.onIdle();
    const [row] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, glCreate.json().id));
    expect(row?.provider).toBe('gitlab');
    expect(row?.host).toBe('gitlab.com');
    expect(row?.insecureTls).toBe(false);

    // Round-trips through Container.vcsFor(): a GitLab repo's PR list comes
    // from the injected MockGitLabClient, not MockGitHubClient.
    const pulls = await app.inject({
      method: 'GET',
      url: `/repos/${glCreate.json().id}/pulls`,
    });
    expect(pulls.statusCode).toBe(200);
    expect(pulls.json().length).toBeGreaterThan(0);

    await app.close();
  });

  it('POST /repos with insecure_tls: true persists on a self-hosted GitLab repo', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        gitlab: new MockGitLabClient(),
      },
    });

    const create = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://gitlab.mycompany.internal/team/service', insecure_tls: true },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().provider).toBe('gitlab');
    expect(create.json().host).toBe('gitlab.mycompany.internal');
    expect(create.json().insecure_tls).toBe(true);

    const [row] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, create.json().id));
    expect(row?.insecureTls).toBe(true);

    await app.close();
  });

  it('GET /repos/:id/pulls imports PRs (mock GitHub) idempotently', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const repos = await app.inject({ method: 'GET', url: '/repos' });
    const repoId = repos.json()[0]!.id;

    const first = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(first.statusCode).toBe(200);
    expect(first.json().length).toBeGreaterThan(0);
    // import again → still idempotent (unique repo_id+number)
    const second = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(second.json().length).toBe(first.json().length);
    await app.close();
  });

  it('POST /repos/:id/poll syncs PR list and does NOT trigger a review', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const repoId = (await app.inject({ method: 'GET', url: '/repos' })).json()[0]!.id;
    const poll = await app.inject({ method: 'POST', url: `/repos/${repoId}/poll` });
    expect(poll.json().reviewTriggered).toBe(false);
    expect(poll.json().synced).toBeGreaterThan(0);
    await app.close();
  });
});
