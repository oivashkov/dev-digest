import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { PrRiskBrief } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[reviews-risk-brief-repo] Docker not available — skipping integration tests.');
}

/**
 * `pr_brief` persistence accessors (Step 3, `specs/03-pr-why-risk-brief-plan.md`)
 * — `upsertPrBrief`/`getPrBrief` on `pull.repo.ts`, delegated through
 * `ReviewRepository`. Unlike `pr_intent`, `pr_brief.json` is a single jsonb
 * column holding the WHOLE `PrRiskBrief` object (including `head_sha`, OQ4) —
 * no migration, the table already exists (`server/src/db/schema/reviews.ts:93-97`).
 */
d('ReviewRepository — pr_brief accessors (Testcontainers pg)', () => {
  let pg: PgFixture;
  let repo: ReviewRepository;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    repo = new ReviewRepository(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  let repoSeq = 0;
  async function createPr() {
    const name = `risk-brief-repo-${repoSeq++}`;
    const [dbRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: dbRepo!.id,
        number: 501,
        title: 'Add token-bucket rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        status: 'needs_review',
      })
      .returning();
    return pr!;
  }

  function brief(prId: string, overrides: Partial<PrRiskBrief> = {}): PrRiskBrief {
    return {
      pr_id: prId,
      what: 'Adds a token-bucket rate limiter in front of the payments API.',
      why: 'Protects the payments API from abuse under load.',
      risks: [
        {
          kind: 'reliability',
          title: 'Limiter bypass on retry storms',
          explanation: 'A client retrying aggressively could still exceed the bucket briefly.',
          severity: 'medium',
          file_refs: ['src/rate-limit/bucket.ts'],
        },
      ],
      review_focus: [
        { file: 'src/rate-limit/bucket.ts', line: 42, reason: 'Core bucket refill logic.' },
      ],
      risk_level: 'medium',
      head_sha: 'a1b2c3d4',
      ...overrides,
    };
  }

  it('round-trips a full PrRiskBrief, including head_sha', async () => {
    const pr = await createPr();
    const written = brief(pr.id);

    await repo.upsertPrBrief(pr.id, written);
    const read = await repo.getPrBrief(pr.id);

    expect(read).toEqual(written);
  });

  it('a second upsert replaces the row rather than duplicating it', async () => {
    const pr = await createPr();
    await repo.upsertPrBrief(pr.id, brief(pr.id, { what: 'First pass summary.' }));

    const updated = brief(pr.id, {
      what: 'Refreshed summary after a new commit.',
      head_sha: 'e5f6a7b8',
      risk_level: 'high',
    });
    await repo.upsertPrBrief(pr.id, updated);

    const read = await repo.getPrBrief(pr.id);
    expect(read).toEqual(updated);

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1);
  });

  it('a malformed blob reads back as undefined rather than throwing', async () => {
    const pr = await createPr();
    // Deliberately missing required fields (`risk_level`, `head_sha`, ...) —
    // simulates a legacy/corrupt row; `json` is untyped jsonb so nothing at
    // the DB layer prevents this from being written.
    await pg.handle.db.insert(t.prBrief).values({ prId: pr.id, json: { what: 'incomplete' } });

    await expect(repo.getPrBrief(pr.id)).resolves.toBeUndefined();
  });

  it('getPrBrief returns undefined when no row exists for the PR', async () => {
    const pr = await createPr();
    await expect(repo.getPrBrief(pr.id)).resolves.toBeUndefined();
  });
});
