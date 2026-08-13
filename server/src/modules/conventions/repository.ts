import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionCategory } from '@devdigest/shared';
import { CONVENTIONS_EXTRACT_JOB_KIND } from './constants.js';

/**
 * Conventions data-access. Owns the `conventions` table; reads (never writes)
 * `repos` for the clone path + display name, and `jobs` for scan status.
 * Workspace-scoped throughout.
 */

import type { ConventionRow } from '../../db/rows.js';
export type { ConventionRow };

export interface RepoBasics {
  id: string;
  fullName: string;
  clonePath: string | null;
}

export interface NewConventionCandidate {
  category: ConventionCategory;
  rule: string;
  evidencePath: string;
  evidenceLineRange: string;
  evidenceSnippet: string;
  confidence: number;
}

export interface UpdateConvention {
  rule?: string;
  evidenceSnippet?: string;
  accepted?: boolean;
}

export type ScanStatus = 'idle' | 'scanning' | 'failed';

export class ConventionsRepository {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, fullName: t.repos.fullName, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.createdAt));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async insertMany(
    workspaceId: string,
    repoId: string,
    rows: NewConventionCandidate[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insert(t.conventions).values(
      rows.map((r) => ({
        workspaceId,
        repoId,
        category: r.category,
        rule: r.rule,
        evidencePath: r.evidencePath,
        evidenceLineRange: r.evidenceLineRange,
        evidenceSnippet: r.evidenceSnippet,
        confidence: r.confidence,
        accepted: false,
      })),
    );
  }

  /** Re-scan replacement: clears every NOT-yet-accepted candidate for the repo.
   *  Accepted candidates are never touched by a re-scan. */
  async deleteUnacceptedForRepo(workspaceId: string, repoId: string): Promise<void> {
    await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.accepted, false),
        ),
      );
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.evidenceSnippet !== undefined ? { evidenceSnippet: patch.evidenceSnippet } : {}),
        ...(patch.accepted !== undefined ? { accepted: patch.accepted } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /**
   * Scan status derived from the newest extraction job for this repo (there's
   * no dedicated status column — the job row IS the status). `payload` is
   * jsonb and small in volume, so filtering by `repoId` in JS after an
   * indexed workspace+kind fetch is consistent with how the rest of this
   * codebase avoids jsonb path operators for low-cardinality lookups.
   */
  async getScanStatus(workspaceId: string, repoId: string): Promise<ScanStatus> {
    const rows = await this.db
      .select({ status: t.jobs.status, payload: t.jobs.payload })
      .from(t.jobs)
      .where(and(eq(t.jobs.workspaceId, workspaceId), eq(t.jobs.kind, CONVENTIONS_EXTRACT_JOB_KIND)))
      .orderBy(desc(t.jobs.scheduledAt))
      .limit(20);
    const latest = rows.find((r) => (r.payload as { repoId?: string } | null)?.repoId === repoId);
    if (!latest) return 'idle';
    if (latest.status === 'queued' || latest.status === 'running') return 'scanning';
    if (latest.status === 'failed') return 'failed';
    return 'idle';
  }

  /** Most recent time any candidate was persisted for this repo — "last scan". */
  async getLastScanAt(workspaceId: string, repoId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ createdAt: t.conventions.createdAt })
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.createdAt))
      .limit(1);
    return row?.createdAt ?? null;
  }
}
