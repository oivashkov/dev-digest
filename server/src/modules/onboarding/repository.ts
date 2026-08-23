import { and, desc, eq } from 'drizzle-orm';
import type { Onboarding } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { ONBOARDING_GENERATE_JOB_KIND } from './constants.js';

/**
 * Onboarding data-access. Owns the `onboarding` table (one row per repo, no
 * history — Q4); reads (never writes) `repos` for the clone path + display
 * name, and `jobs` for generation status. `onboarding` has no `workspace_id`
 * column, so every read/write is scoped THROUGH `repos` instead.
 */

import type { OnboardingRow } from '../../db/rows.js';
export type { OnboardingRow };

export interface RepoBasics {
  id: string;
  fullName: string;
  clonePath: string | null;
}

export type OnboardingJobStatus = 'idle' | 'generating' | 'failed';

export class OnboardingRepository {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, fullName: t.repos.fullName, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async get(repoId: string): Promise<OnboardingRow | undefined> {
    const [row] = await this.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repoId));
    return row;
  }

  /** Overwrite in place (Q4) — `repoId` is the PK, no version history. */
  async upsert(repoId: string, tour: Onboarding): Promise<void> {
    const generatedAt = new Date();
    await this.db
      .insert(t.onboarding)
      .values({ repoId, json: tour, generatedAt })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { json: tour, generatedAt },
      });
  }

  /**
   * Job status derived from the newest generation job for this repo — same
   * 20-row-window approach as `ConventionsRepository.getScanStatus`
   * (`conventions/repository.ts`), including its known limitation: on a
   * workspace with 20+ onboarding jobs enqueued across OTHER repos since
   * this repo's last one, this repo's job falls outside the window and
   * reads as `idle`. Copied as-is for consistency (SPEC-02 plan §11).
   */
  async getJobStatus(workspaceId: string, repoId: string): Promise<OnboardingJobStatus> {
    const rows = await this.db
      .select({ status: t.jobs.status, payload: t.jobs.payload })
      .from(t.jobs)
      .where(and(eq(t.jobs.workspaceId, workspaceId), eq(t.jobs.kind, ONBOARDING_GENERATE_JOB_KIND)))
      .orderBy(desc(t.jobs.scheduledAt))
      .limit(20);
    const latest = rows.find((r) => (r.payload as { repoId?: string } | null)?.repoId === repoId);
    if (!latest) return 'idle';
    if (latest.status === 'queued' || latest.status === 'running') return 'generating';
    if (latest.status === 'failed') return 'failed';
    return 'idle';
  }
}
