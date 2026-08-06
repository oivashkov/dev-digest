/**
 * FINDINGS column on GET /repos/:id/pulls.
 *
 * The value mirrors the SCORE column's source: the PR's LATEST review only
 * (not summed across reviews, unlike COST), with dismissed findings excluded
 * — same semantics as the "blockers" count already computed client-side in
 * ReviewRunAccordion.tsx. Real Postgres because it's a real IN-query + JS
 * grouping over two tables, same reasoning as pulls-cost.it.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;

/** A repo with one PR, created directly (no GitHub sync) so reviews can attach to it. */
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `findings-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 471,
      title: 'Refactor invoice PDF renderer',
      author: 'sara.lin',
      branch: 'refactor/invoice-pdf',
      base: 'main',
      headSha: 'deadbeef',
      additions: 620,
      deletions: 260,
      filesCount: 12,
      status: 'open',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

async function addReview(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  prId: string,
  values: { createdAt: Date; score: number },
) {
  const [review] = await db
    .insert(t.reviews)
    .values({ workspaceId, prId, kind: 'review', score: values.score, createdAt: values.createdAt })
    .returning();
  return review!;
}

async function addFinding(
  db: PgFixture['handle']['db'],
  reviewId: string,
  values: {
    severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
    title: string;
    dismissedAt?: Date | null;
  },
) {
  await db.insert(t.findings).values({
    reviewId,
    file: 'src/x.ts',
    startLine: 1,
    endLine: 1,
    severity: values.severity,
    category: 'bug',
    title: values.title,
    rationale: 'Because.',
    confidence: 0.8,
    dismissedAt: values.dismissedAt ?? null,
  });
}

/** The list route syncs from GitHub first; an empty mock keeps it a no-op. */
const listPulls = async (db: PgFixture['handle']['db'], repoId: string) => {
  const app = await buildApp({
    config: config(),
    db,
    overrides: { github: new MockGitHubClient({ pulls: [] }) },
  });
  const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
  expect(res.statusCode).toBe(200);
  return res.json() as PrMeta[];
};

d('PR list findings column (Testcontainers pg)', () => {
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

  it('reports findings from the latest review only, not combined with an older one', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const older = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-01T09:00:00Z'),
      score: 40,
    });
    await addFinding(pg.handle.db, older.id, { severity: 'CRITICAL', title: 'Old finding' });

    const latest = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-02T09:00:00Z'),
      score: 61,
    });
    await addFinding(pg.handle.db, latest.id, { severity: 'WARNING', title: 'New warning A' });
    await addFinding(pg.handle.db, latest.id, { severity: 'WARNING', title: 'New warning B' });

    const [row] = await listPulls(pg.handle.db, repo.id);
    // Combining both reviews would report 3; only the latest review's 2 count.
    expect(row!.findings).toHaveLength(2);
    expect(row!.findings!.every((f) => f.severity === 'WARNING')).toBe(true);
    expect(row!.findings!.map((f) => f.title).sort()).toEqual(['New warning A', 'New warning B']);
  });

  it('excludes a dismissed finding from the payload', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const review = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-01T09:00:00Z'),
      score: 70,
    });
    await addFinding(pg.handle.db, review.id, { severity: 'SUGGESTION', title: 'Kept' });
    await addFinding(pg.handle.db, review.id, {
      severity: 'SUGGESTION',
      title: 'Dismissed',
      dismissedAt: new Date('2026-06-01T10:00:00Z'),
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.findings).toHaveLength(1);
    expect(row!.findings![0]!.title).toBe('Kept');
  });

  it('reports null — never [] — for a PR with no review', async () => {
    const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.findings).toBeNull();
  });
});
