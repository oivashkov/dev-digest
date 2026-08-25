import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import { PrRiskBrief } from '@devdigest/shared';
import type { Intent } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

export async function upsertIntent(db: Db, prId: string, intent: Intent): Promise<void> {
  const now = new Date();
  await db
    .insert(t.prIntent)
    .values({
      prId,
      intent: intent.intent,
      inScope: intent.in_scope,
      outOfScope: intent.out_of_scope,
      confidence: intent.confidence,
      source: intent.source ?? null,
      planRefs: intent.plan_refs,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      set: {
        intent: intent.intent,
        inScope: intent.in_scope,
        outOfScope: intent.out_of_scope,
        confidence: intent.confidence,
        source: intent.source ?? null,
        planRefs: intent.plan_refs,
        updatedAt: now,
      },
    });
}

export async function getIntent(db: Db, prId: string): Promise<Intent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    // `confidence` is NOT nullable on the Intent contract — every write path
    // (Step 4's getOrComputeIntent) always sets it via tierFor(). A NULL here
    // can only mean a pre-Step-2 row written before this column existed;
    // coalesce to 0 (lowest tier) rather than let Intent.parse() throw.
    confidence: row.confidence ?? 0,
    source: row.source as Intent['source'],
    plan_refs: row.planRefs,
  };
}

// ---- risk brief -------------------------------------------------------------

/**
 * `pr_brief.json` (`server/src/db/schema/reviews.ts:93-97`) holds the WHOLE
 * `PrRiskBrief` object — including `pr_id` and `head_sha` (OQ4) — as one
 * jsonb blob, unlike `pr_intent`'s individually-typed columns. No migration:
 * the table and column already exist.
 */
export async function upsertPrBrief(db: Db, prId: string, brief: PrRiskBrief): Promise<void> {
  await db
    .insert(t.prBrief)
    .values({ prId, json: brief })
    .onConflictDoUpdate({
      target: t.prBrief.prId,
      set: { json: brief },
    });
}

export async function getPrBrief(db: Db, prId: string): Promise<PrRiskBrief | undefined> {
  const [row] = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
  if (!row) return undefined;
  // `json` is untyped jsonb — there is no `$type<>` compile-time guarantee the
  // blob still matches `PrRiskBrief` (a malformed/legacy row must degrade to
  // `undefined`, not throw — root `INSIGHTS.md` 2026-08-23's silent-drift
  // warning is exactly this case).
  const parsed = PrRiskBrief.safeParse(row.json);
  return parsed.success ? parsed.data : undefined;
}
