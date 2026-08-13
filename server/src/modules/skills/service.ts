import type { Container } from '../../platform/container.js';
import type { Skill, SkillSource, SkillStats, SkillSummary, SkillType, SkillVersion } from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { MAX_IMPORT_BYTES } from './constants.js';
import { SkillsRepository, type SkillRow } from './repository.js';
import { computeSkillStats, extractSkillCore, toSkillDto, type ExtractedSkillCore } from './helpers.js';

/**
 * Skills service. Business logic for the Skills Lab list/editor and the
 * import-preview flow. Attaching a skill to an agent stays with
 * `AgentsService`/`AgentsRepository` (the `agent_skills` link table).
 */

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  /** List with each skill's usage summary embedded (see SkillSummary's doc
   *  comment) — one stats computation per skill; fine at this app's scale,
   *  and keeps a single source of truth with `getStats` below. */
  async list(workspaceId: string): Promise<SkillSummary[]> {
    const rows = await this.repo.list(workspaceId);
    return Promise.all(
      rows.map(async (row) => {
        const stats = await this.computeStats(workspaceId, row);
        return {
          ...toSkillDto(row),
          used_by: stats.used_by,
          pull_frequency_pct: stats.pull_frequency_pct,
          accept_rate_pct: stats.accept_rate_pct,
        };
      }),
    );
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  /** Full usage stats for the Stats tab — see SkillStats' doc comment for the
   *  category-matching approximation this relies on. */
  async getStats(workspaceId: string, id: string): Promise<SkillStats | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) return undefined;
    return this.computeStats(workspaceId, row);
  }

  private async computeStats(workspaceId: string, row: SkillRow): Promise<SkillStats> {
    const agents = await this.repo.listAgentsForSkill(workspaceId, row.id);
    const reviews = await this.repo.listReviewsForAgents(
      workspaceId,
      agents.map((a) => a.id),
    );
    const findings = await this.repo.listFindingsForReviews(reviews.map((r) => r.id));
    return computeSkillStats(row.type as SkillType, agents, reviews, findings);
  }

  /** Body-snapshot history for the Versions tab, newest first. Undefined when
   *  the skill itself doesn't exist (workspace-scoped) — distinct from an
   *  empty array, which can't actually happen (insert always snapshots v1). */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const versions = await this.repo.listVersions(id);
    return versions.map((v) => ({
      skill_id: v.skillId,
      version: v.version,
      body: v.body,
      summary: v.summary ?? null,
      created_at: v.createdAt.toISOString(),
    }));
  }

  /**
   * Restore an earlier body snapshot as the skill's current body — everything
   * else (name/description/type/enabled) is left as-is. This is itself a
   * content change, so it bumps the version and snapshots again (labeled
   * "Restored to vN"), never rewrites history in place.
   */
  async restoreVersion(workspaceId: string, id: string, version: number): Promise<Skill | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const target = await this.repo.getVersion(id, version);
    if (!target) throw new NotFoundError(`Skill has no version ${version}`);
    const row = await this.repo.update(workspaceId, id, { body: target.body }, `Restored to v${version}`);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source,
      body: input.body,
      enabled: input.enabled,
      evidenceFiles: input.evidence_files,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.evidence_files !== undefined ? { evidenceFiles: patch.evidence_files } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Parse an uploaded file (markdown or zip) into a skill preview. NOT
   * persisted — the client shows this for confirmation, then calls `create`
   * with the (possibly edited) result.
   */
  importPreview(filename: string, contentBase64: string): ExtractedSkillCore {
    const buffer = Buffer.from(contentBase64, 'base64');
    if (buffer.byteLength > MAX_IMPORT_BYTES) {
      throw new ValidationError(`File exceeds the ${MAX_IMPORT_BYTES} byte import limit`);
    }
    return extractSkillCore(filename, buffer);
  }
}
