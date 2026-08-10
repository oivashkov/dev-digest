import type { Container } from '../../platform/container.js';
import type { PrMeta, PrDetail, VcsClient, PrReviewComment, PrCommentInput } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { PullsRepository, type PullRow } from './repository.js';
import { deriveReviewStatus } from './status.js';
import { findingRowToDto } from '../reviews/helpers.js';
import { BACKFILL_LIMIT } from './constants.js';

/**
 * F1 — pulls service. Business logic for the Pull Requests feature: import
 * (list sync + diff-stat backfill), score/findings/cost aggregation for the
 * list, PR detail refresh (local-first), and the inline review-comments
 * proxy. No HTTP and no raw SQL live here — persistence goes through
 * PullsRepository.
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL and
 * owned by the reviews module — this service only imports/reads.
 */

/** Minimal structured logger (pino-compatible) — kept local so this file
 *  never imports Fastify types. */
export type Logger = { warn: (obj: unknown, msg?: string) => void };

export class PullsService {
  private repo: PullsRepository;

  constructor(private container: Container) {
    this.repo = new PullsRepository(container.db);
  }

  async listForRepo(workspaceId: string, repoId: string, log: Logger): Promise<PrMeta[]> {
    const repo = await this.repo.getRepoInWorkspace(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    let gh: VcsClient | null = null;
    try {
      gh = await this.container.vcsFor(repo);
    } catch (err) {
      log.warn({ err }, 'VCS client unavailable (no token / offline); serving persisted PRs');
    }

    // Local-first: sync from GitHub/GitLab when a token is configured, but
    // never fail the read — already-imported/seeded PRs stay viewable offline.
    if (gh) {
      try {
        const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name, host: repo.host });
        for (const pr of pulls) {
          await this.repo.upsertPull({ workspaceId, repoId: repo.id, ...pr });
        }
      } catch (err) {
        log.warn({ err }, 'PR sync skipped (no token / offline); serving persisted PRs');
      }
    }

    const rows = await this.repo.listForRepo(repo.id);

    if (gh) {
      const needStats = rows
        .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
        .slice(0, BACKFILL_LIMIT);
      for (const r of needStats) {
        try {
          const detail = await gh.getPullRequest(
            { owner: repo.owner, name: repo.name, host: repo.host },
            r.number,
          );
          await this.repo.backfillDiffStats(r.id, {
            additions: detail.additions,
            deletions: detail.deletions,
            filesCount: detail.files_count,
          });
          r.additions = detail.additions;
          r.deletions = detail.deletions;
          r.filesCount = detail.files_count;
        } catch (err) {
          log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
        }
      }
    }

    // Latest-review SCORE + FINDINGS, and total COST, per PR for the list's
    // columns. Computed on read (no FK denorm); the list is small, so a
    // couple of IN-queries + JS grouping is cheap.
    const prIds = rows.map((r) => r.id);
    const latestReviewByPr = await this.repo.latestReviewsByPr(prIds);
    const latestReviewIds = [...latestReviewByPr.values()].map((rv) => rv.id);
    const findingsByReviewId = await this.repo.findingsByReviewIds(latestReviewIds);
    const totalCostByPr = await this.repo.totalCostByPr(prIds);

    const now = Date.now();
    return rows.map((r) => {
      const review = latestReviewByPr.get(r.id);
      return {
        id: r.id,
        number: r.number,
        title: r.title,
        author: r.author,
        branch: r.branch,
        base: r.base,
        head_sha: r.headSha,
        additions: r.additions,
        deletions: r.deletions,
        files_count: r.filesCount,
        status: deriveReviewStatus({
          ghStatus: r.status,
          lastReviewedSha: r.lastReviewedSha,
          headSha: r.headSha,
          updatedAt: r.updatedAt,
          now,
        }),
        opened_at: r.openedAt?.toISOString() ?? null,
        updated_at: r.updatedAt?.toISOString() ?? null,
        score: review ? review.score : null,
        cost_usd: totalCostByPr.get(r.id) ?? null,
        findings: review ? (findingsByReviewId.get(review.id) ?? []).map(findingRowToDto) : null,
      };
    });
  }

  async getDetail(workspaceId: string, prId: string, log: Logger): Promise<PrDetail> {
    const { pr, repo } = await this.requirePrAndRepo(workspaceId, prId);

    // Local-first: refresh detail from GitHub/GitLab when a token is
    // configured; otherwise serve the persisted files/commits/body (seeded or
    // previously imported) so PR detail works offline.
    try {
      const gh = await this.container.vcsFor(repo);
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name, host: repo.host }, pr.number);
      await this.repo.refreshDetail(pr.id, detail);
      return { ...detail, id: pr.id };
    } catch (err) {
      log.warn({ err }, 'PR detail refresh skipped (no token / offline); serving persisted detail');
      const files = await this.repo.getPrFiles(pr.id);
      const commits = await this.repo.getPrCommits(pr.id);
      return {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        head_sha: pr.headSha,
        additions: pr.additions,
        deletions: pr.deletions,
        files_count: pr.filesCount,
        status: pr.status as PrDetail['status'],
        opened_at: pr.openedAt?.toISOString() ?? null,
        updated_at: pr.updatedAt?.toISOString() ?? null,
        body: pr.body ?? null,
        files: files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committed_at: c.committedAt?.toISOString() ?? null,
        })),
      };
    }
  }

  // ---- Inline review comments (Files changed tab) -------------------------
  // Proxied live to GitHub (no local persistence): listComments reflects
  // existing PR comments; createComment posts one immediately. Keeps the tab
  // in lock-step with GitHub and avoids a stale local mirror.

  async listComments(workspaceId: string, id: string, log: Logger): Promise<PrReviewComment[]> {
    const { pr, repo } = await this.requirePrAndRepo(workspaceId, id);
    let gh: VcsClient;
    try {
      gh = await this.container.vcsFor(repo);
    } catch (err) {
      log.warn({ err }, 'VCS client unavailable; serving no PR comments');
      return [];
    }
    try {
      return await gh.listReviewComments({ owner: repo.owner, name: repo.name, host: repo.host }, pr.number);
    } catch (err) {
      log.warn({ err }, 'Review-comments fetch skipped (offline / error)');
      return [];
    }
  }

  async createComment(workspaceId: string, id: string, input: PrCommentInput): Promise<PrReviewComment> {
    const { pr, repo } = await this.requirePrAndRepo(workspaceId, id);
    let gh: VcsClient;
    try {
      gh = await this.container.vcsFor(repo);
    } catch {
      throw new AppError(
        'vcs_unavailable',
        `Connect a ${repo.provider === 'gitlab' ? 'GitLab' : 'GitHub'} token to post comments.`,
        400,
      );
    }
    try {
      return await gh.createReviewComment({ owner: repo.owner, name: repo.name, host: repo.host }, pr.number, {
        commitId: pr.headSha,
        path: input.path,
        line: input.line,
        ...(input.side ? { side: input.side } : {}),
        body: input.body,
        ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
      });
    } catch (err) {
      // GitHub/GitLab reject comments on lines outside the diff / on closed PRs.
      const msg = err instanceof Error ? err.message : 'Failed to post the comment.';
      throw new AppError('vcs_comment_failed', msg, 400, { cause: String(err) });
    }
  }

  /** PR + its repo, workspace-scoped via the PR. Distinct 404 messages match
   *  which lookup actually failed (mirrors the pre-refactor inline checks). */
  private async requirePrAndRepo(
    workspaceId: string,
    id: string,
  ): Promise<{ pr: PullRow; repo: NonNullable<Awaited<ReturnType<PullsRepository['getRepoById']>>> }> {
    const pr = await this.repo.getPullInWorkspace(workspaceId, id);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepoById(pr.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }
}
