/**
 * `GET /pulls/:id/blast` (server/src/modules/reviews/routes.ts + service.ts
 * `getBlastRadius` + `reviews/blast.ts`'s pure mapper). Real Postgres — same
 * reasoning as `reviews-smart-diff-routes.it.test.ts`: the route composes a
 * `getPrFiles` read with two `container.repoIntel` facade calls
 * (`getBlastRadius` + `getIndexState`), and none of the fixtures here index
 * a repo (no clone on disk), so `repoIntel` naturally exercises its
 * degraded/no-data path (`RepoIntelService.getBlastRadius`: no
 * `repos.clone_path` → returns the empty `degraded: true, reason: 'no_data'`
 * result without touching `container.codeIndex`). No LLM/VCS call happens on
 * this route, so a plain `MockGitClient`/`MockGitHubClient` override keeps
 * `buildApp` hermetic, same as smart-diff's fixture.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrBlastRadius } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[reviews-blast] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;

async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `blast-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 501,
      title: 'Rework charge flow',
      author: 'marisa.koch',
      branch: 'feat/blast',
      base: 'main',
      headSha: 'deadbeef',
      additions: 0,
      deletions: 0,
      filesCount: 0,
      status: 'needs_review',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

async function addPrFile(
  db: PgFixture['handle']['db'],
  prId: string,
  values: { path: string; additions: number; deletions: number },
) {
  await db.insert(t.prFiles).values({ prId, ...values, patch: `@@ -1,1 +1,${values.additions} @@` });
}

d('GET /pulls/:id/blast (Testcontainers pg)', () => {
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

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  it('200s with a valid PrBlastRadius for a PR that has changed files', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addPrFile(pg.handle.db, pr.id, { path: 'src/payments/service.ts', additions: 5, deletions: 1 });

    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PrBlastRadius;

    expect(body.pr_id).toBe(pr.id);
    expect(Array.isArray(body.symbols)).toBe(true);
    expect(body.counts).toEqual({
      symbols: body.symbols.length,
      callers: body.counts.callers,
      endpoints: body.impacted_endpoints.length,
      crons: body.impacted_crons.length,
    });

    await app.close();
  });

  it('degrades gracefully (status: degraded, reason set) for a repo with no repo-intel index', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addPrFile(pg.handle.db, pr.id, { path: 'src/payments/service.ts', additions: 5, deletions: 1 });

    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PrBlastRadius;

    expect(body.status).toBe('degraded');
    expect(body.reason).toBeTruthy();
    expect(body.symbols).toEqual([]);

    await app.close();
  });

  it('404s for an unknown PR id and for a PR that belongs to a different workspace', async () => {
    const app = await makeApp();

    const unknown = await app.inject({ method: 'GET', url: `/pulls/${randomUUID()}/blast` });
    expect(unknown.statusCode).toBe(404);

    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-blast' }).returning();
    const { pr: foreignPr } = await setupRepoAndPr(pg.handle.db, otherWs!.id);
    const wrongWorkspace = await app.inject({ method: 'GET', url: `/pulls/${foreignPr.id}/blast` });
    expect(wrongWorkspace.statusCode).toBe(404);

    await app.close();
  });
});
