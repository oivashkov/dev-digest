import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';
import {
  isSkillContentChange,
  summarizeSkillChange,
  type SkillStatsFindingRow,
  type SkillStatsReviewRow,
} from './helpers.js';

/**
 * Skills data-access. Owns `skills` and `skill_versions`. Mirrors
 * `modules/agents/repository.ts`'s shape (insert snapshots version 1, update
 * bumps + snapshots on content change). Does NOT touch `agent_skills` — that
 * link table stays owned by `AgentsRepository` (see its own header comment),
 * though this repo reads it (read-only, joined against `agents`) to answer
 * "which agents use this skill" for the stats queries below.
 * Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description?: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db.select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Delete a skill (scoped to workspace). `agent_skills` links + `skill_versions`
   *  cascade via FK. Returns false if no such skill existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Insert a skill AND record version 1 in skill_versions (immutable snapshot). */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const source = values.source ?? 'manual';
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? '',
        type: values.type,
        source,
        body: values.body,
        // "Someone else's skill is someone else's instructions in the
        // prompt" — a skill from an untrusted source (anything but a
        // hand-authored 'manual' one) is created DISABLED by default, so an
        // import can never silently start feeding an agent's prompt. An
        // explicit `enabled` in the request always wins.
        enabled: values.enabled ?? source === 'manual',
        version: INITIAL_SKILL_VERSION,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_SKILL_VERSION, 'Initial version');
    return row!;
  }

  /**
   * Update a skill. A content change (anything except just toggling `enabled`)
   * bumps the version and snapshots the new body into skill_versions, labeled
   * with `summaryOverride` if given, else an auto-generated "Updated X, Y".
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
    summaryOverride?: string,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const contentChanged = isSkillContentChange(existing, patch);
    const nextVersion = contentChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.evidenceFiles !== undefined ? { evidenceFiles: patch.evidenceFiles } : {}),
        ...(contentChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (contentChanged && row) {
      await this.snapshotVersion(row, nextVersion, summaryOverride ?? summarizeSkillChange(existing, patch));
    }
    return row;
  }

  private async snapshotVersion(row: SkillRow, version: number, summary: string): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId: row.id, version, body: row.body, summary })
      .onConflictDoNothing();
  }

  // ---- skill_versions (immutable body snapshots) ---------------------------

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single body snapshot, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  // ---- stats (read-only, cross-module joins) --------------------------------

  /** Agents (workspace-scoped) this skill is currently attached to. */
  async listAgentsForSkill(
    workspaceId: string,
    skillId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)));
  }

  /** `review`-kind reviews (not run summaries) by the given agents. */
  async listReviewsForAgents(workspaceId: string, agentIds: string[]): Promise<SkillStatsReviewRow[]> {
    if (agentIds.length === 0) return [];
    return this.db
      .select({ id: t.reviews.id, createdAt: t.reviews.createdAt })
      .from(t.reviews)
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          inArray(t.reviews.agentId, agentIds),
          eq(t.reviews.kind, 'review'),
        ),
      );
  }

  /** Findings on the given reviews, with each finding's review createdAt joined in. */
  async listFindingsForReviews(reviewIds: string[]): Promise<SkillStatsFindingRow[]> {
    if (reviewIds.length === 0) return [];
    return this.db
      .select({
        reviewId: t.findings.reviewId,
        category: t.findings.category,
        acceptedAt: t.findings.acceptedAt,
        dismissedAt: t.findings.dismissedAt,
        reviewCreatedAt: t.reviews.createdAt,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(inArray(t.findings.reviewId, reviewIds));
  }
}
