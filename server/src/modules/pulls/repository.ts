import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { FindingRow } from '../../db/rows.js';

/**
 * F1 — pulls data-access layer. The ONLY place that touches `pull_requests`,
 * `pr_files`, `pr_commits` and reads `reviews`/`findings`/`agent_runs` for the
 * list's score/findings/cost columns. Every query scoped by `workspaceId`
 * where the row carries one (PR rows do; files/commits are looked up via an
 * already-workspace-checked PR id).
 */

export type PullRow = typeof t.pullRequests.$inferSelect;
export type PrFileRow = typeof t.prFiles.$inferSelect;
export type PrCommitRow = typeof t.prCommits.$inferSelect;

export interface UpsertPullInput {
  workspaceId: string;
  repoId: string;
  number: number;
  title: string;
  author: string;
  branch: string;
  base: string;
  head_sha: string;
  additions: number;
  deletions: number;
  files_count: number;
  status: string;
  opened_at?: string | null;
  updated_at?: string | null;
}

export interface RefreshDetailInput {
  body?: string | null;
  additions: number;
  deletions: number;
  files_count: number;
  files: { path: string; additions: number; deletions: number; patch?: string | null }[];
  commits: { sha: string; message: string; author: string; committed_at?: string | null }[];
}

export class PullsRepository {
  constructor(private db: Db) {}

  async getRepoInWorkspace(workspaceId: string, repoId: string): Promise<typeof t.repos.$inferSelect | undefined> {
    const [repo] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return repo;
  }

  async getRepoById(repoId: string): Promise<typeof t.repos.$inferSelect | undefined> {
    const [repo] = await this.db.select().from(t.repos).where(eq(t.repos.id, repoId));
    return repo;
  }

  /** Idempotent import — one row per repo_id+number (unique constraint). */
  async upsertPull(pr: UpsertPullInput): Promise<void> {
    await this.db
      .insert(t.pullRequests)
      .values({
        workspaceId: pr.workspaceId,
        repoId: pr.repoId,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        headSha: pr.head_sha,
        additions: pr.additions,
        deletions: pr.deletions,
        filesCount: pr.files_count,
        status: pr.status,
        openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
        updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
      })
      .onConflictDoUpdate({
        target: [t.pullRequests.repoId, t.pullRequests.number],
        set: {
          title: pr.title,
          headSha: pr.head_sha,
          status: pr.status,
          updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
        },
      });
  }

  async listForRepo(repoId: string): Promise<PullRow[]> {
    return this.db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repoId));
  }

  async backfillDiffStats(
    id: string,
    stats: { additions: number; deletions: number; filesCount: number },
  ): Promise<void> {
    await this.db.update(t.pullRequests).set(stats).where(eq(t.pullRequests.id, id));
  }

  /** Latest 'review'-kind review per PR (newest first → first seen wins). */
  async latestReviewsByPr(prIds: string[]): Promise<Map<string, { id: string; score: number | null }>> {
    const out = new Map<string, { id: string; score: number | null }>();
    if (prIds.length === 0) return out;
    const reviewRows = await this.db
      .select({ id: t.reviews.id, prId: t.reviews.prId, score: t.reviews.score })
      .from(t.reviews)
      .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
      .orderBy(desc(t.reviews.createdAt));
    for (const rv of reviewRows) {
      if (!out.has(rv.prId)) out.set(rv.prId, { id: rv.id, score: rv.score });
    }
    return out;
  }

  /** Non-dismissed findings for a set of reviews, grouped by review id. */
  async findingsByReviewIds(reviewIds: string[]): Promise<Map<string, FindingRow[]>> {
    const out = new Map<string, FindingRow[]>();
    if (reviewIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(t.findings)
      .where(and(inArray(t.findings.reviewId, reviewIds), isNull(t.findings.dismissedAt)));
    for (const f of rows) {
      const bucket = out.get(f.reviewId);
      if (bucket) bucket.push(f);
      else out.set(f.reviewId, [f]);
    }
    return out;
  }

  /** Total cost across every completed (status='done') run per PR. */
  async totalCostByPr(prIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (prIds.length === 0) return out;
    const runRows = await this.db
      .select({ prId: t.agentRuns.prId, costUsd: t.agentRuns.costUsd })
      .from(t.agentRuns)
      .where(and(inArray(t.agentRuns.prId, prIds), eq(t.agentRuns.status, 'done')));
    for (const run of runRows) {
      if (run.prId && run.costUsd != null) out.set(run.prId, (out.get(run.prId) ?? 0) + run.costUsd);
    }
    return out;
  }

  async getPullInWorkspace(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [pr] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return pr;
  }

  /**
   * Delete+reinsert files/commits + update the PR row, atomically — a crash
   * mid-sequence must not permanently lose this PR's files/commits (see
   * backend-onion-architecture skill, Tier 1 finding #8).
   */
  async refreshDetail(prId: string, detail: RefreshDetailInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
      if (detail.files.length > 0) {
        await tx.insert(t.prFiles).values(
          detail.files.map((f) => ({
            prId,
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
        );
      }
      await tx.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
      if (detail.commits.length > 0) {
        await tx.insert(t.prCommits).values(
          detail.commits.map((c) => ({
            prId,
            sha: c.sha,
            message: c.message,
            author: c.author,
            committedAt: c.committed_at ? new Date(c.committed_at) : null,
          })),
        );
      }
      await tx
        .update(t.pullRequests)
        .set({
          body: detail.body ?? null,
          // Diff stats aren't on GitHub's PR-list payload — backfill them from
          // the detail fetch so the Pull Requests list shows real size/files.
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        })
        .where(eq(t.pullRequests.id, prId));
    });
  }

  async getPrFiles(prId: string): Promise<PrFileRow[]> {
    return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
  }

  async getPrCommits(prId: string): Promise<PrCommitRow[]> {
    return this.db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
  }
}
