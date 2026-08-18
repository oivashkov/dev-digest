/**
 * `GET /pulls/:id/smart-diff` (server/src/modules/reviews/routes.ts +
 * service.ts `getSmartDiff`). Real Postgres because the route composes two
 * repository reads (`getPrFiles` + `reviewsForPull`) that a mocked DB
 * wouldn't exercise honestly (`TESTING.md`: "One real integration per
 * data-backed workflow"). No LLM/VCS call happens on this route — it's a
 * pure, deterministic read+classify, so unlike the intent routes
 * (`server/INSIGHTS.md`, 2026-08-18) there is no `review_intent` model
 * resolution to dodge; a plain `MockGitClient`/`MockGitHubClient` override is
 * enough to keep `buildApp` hermetic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { SmartDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[reviews-smart-diff] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;

async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `smart-diff-${repoSeq++}`;
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

async function addReview(db: PgFixture['handle']['db'], workspaceId: string, prId: string, createdAt: Date) {
  const [review] = await db
    .insert(t.reviews)
    .values({ workspaceId, prId, kind: 'review', score: 70, createdAt })
    .returning();
  return review!;
}

async function addFinding(
  db: PgFixture['handle']['db'],
  reviewId: string,
  values: { file: string; startLine: number; endLine: number; dismissedAt?: Date | null },
) {
  await db.insert(t.findings).values({
    reviewId,
    file: values.file,
    startLine: values.startLine,
    endLine: values.endLine,
    severity: 'WARNING',
    category: 'bug',
    title: 'Some finding',
    rationale: 'Because.',
    confidence: 0.8,
    dismissedAt: values.dismissedAt ?? null,
  });
}

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
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

  it('200s with files grouped by risk for a PR that has no review yet — all finding_lines empty', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addPrFile(pg.handle.db, pr.id, { path: 'src/modules/payments/service.ts', additions: 5, deletions: 1 });
    await addPrFile(pg.handle.db, pr.id, { path: 'src/index.ts', additions: 2, deletions: 0 });
    await addPrFile(pg.handle.db, pr.id, { path: 'package-lock.json', additions: 40, deletions: 10 });

    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;

    expect(body.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    const byRole = new Map(body.groups.map((g) => [g.role, g.files.map((f) => f.path)]));
    expect(byRole.get('core')).toEqual(['src/modules/payments/service.ts']);
    expect(byRole.get('wiring')).toEqual(['src/index.ts']);
    expect(byRole.get('boilerplate')).toEqual(['package-lock.json']);
    expect(body.groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(true);
    expect(body.split_suggestion.total_lines).toBe(5 + 1 + 2 + 0 + 40 + 10);

    await app.close();
  });

  it('200s with finding_lines populated from the latest review, excluding dismissed findings', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addPrFile(pg.handle.db, pr.id, { path: 'src/modules/payments/service.ts', additions: 5, deletions: 1 });

    // Older review: must be ignored entirely — only the latest review's
    // findings should surface (same semantics as `pulls-findings.it.test.ts`).
    const older = await addReview(pg.handle.db, workspaceId, pr.id, new Date('2026-06-01T09:00:00Z'));
    await addFinding(pg.handle.db, older.id, { file: 'src/modules/payments/service.ts', startLine: 99, endLine: 99 });

    const latest = await addReview(pg.handle.db, workspaceId, pr.id, new Date('2026-06-02T09:00:00Z'));
    await addFinding(pg.handle.db, latest.id, { file: 'src/modules/payments/service.ts', startLine: 12, endLine: 12 });
    await addFinding(pg.handle.db, latest.id, {
      file: 'src/modules/payments/service.ts',
      startLine: 40,
      endLine: 41,
      dismissedAt: new Date('2026-06-02T10:00:00Z'),
    });

    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;

    const core = body.groups.find((g) => g.role === 'core')!;
    const file = core.files.find((f) => f.path === 'src/modules/payments/service.ts')!;
    // Only the latest review's non-dismissed finding (line 12) shows up —
    // neither the older review's line 99 nor the dismissed line 40.
    expect(file.finding_lines).toEqual([12]);

    await app.close();
  });

  it('404s for an unknown PR id and for a PR that belongs to a different workspace', async () => {
    const app = await makeApp();

    const unknown = await app.inject({ method: 'GET', url: `/pulls/${randomUUID()}/smart-diff` });
    expect(unknown.statusCode).toBe(404);

    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-smart-diff' }).returning();
    const { pr: foreignPr } = await setupRepoAndPr(pg.handle.db, otherWs!.id);
    const wrongWorkspace = await app.inject({ method: 'GET', url: `/pulls/${foreignPr.id}/smart-diff` });
    expect(wrongWorkspace.statusCode).toBe(404);

    await app.close();
  });
});
