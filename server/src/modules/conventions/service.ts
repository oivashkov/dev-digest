import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConventionCandidate, ConventionsState, UpdateConventionCandidate } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import {
  CONVENTIONS_EXTRACT_JOB_KIND,
  CONVENTION_EXTRACTION_SCHEMA_NAME,
  MAX_FILE_CHARS,
  SAMPLE_FILE_COUNT,
} from './constants.js';
import { toConventionCandidateDto } from './helpers.js';
import {
  ConventionsRepository,
  type NewConventionCandidate,
  type UpdateConvention,
} from './repository.js';
import { buildConventionExtractionPrompt, ConventionExtractionSchema, type SampledFile } from './prompt.js';

/**
 * Conventions service. Business logic for the Conventions Lab candidate
 * list — extraction (LLM-driven, run as a background job) and the
 * accept/reject/edit loop (synchronous CRUD over the `conventions` table).
 */

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  async getState(workspaceId: string, repoId: string): Promise<ConventionsState> {
    const [rows, scanStatus, lastScanAt] = await Promise.all([
      this.repo.list(workspaceId, repoId),
      this.repo.getScanStatus(workspaceId, repoId),
      this.repo.getLastScanAt(workspaceId, repoId),
    ]);
    return {
      candidates: rows.map(toConventionCandidateDto),
      sample_file_count: SAMPLE_FILE_COUNT,
      last_scan_at: lastScanAt ? lastScanAt.toISOString() : null,
      scan_status: scanStatus,
    };
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.list(workspaceId, repoId);
    return rows.map(toConventionCandidateDto);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConventionCandidate,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.update(workspaceId, id, patch as UpdateConvention);
    return row ? toConventionCandidateDto(row) : undefined;
  }

  /** Enqueue extraction; never blocks the HTTP handler on the LLM call.
   *  202 even when enqueue fails (no handler / DB hiccup), same degraded-path
   *  shape as `repo-intel`'s resync route — the client polls `getState`. */
  async triggerExtraction(
    workspaceId: string,
    repoId: string,
  ): Promise<{ jobId: string | null; degraded?: boolean }> {
    try {
      const job = await this.container.jobs.enqueue(workspaceId, CONVENTIONS_EXTRACT_JOB_KIND, {
        workspaceId,
        repoId,
      });
      return { jobId: job.id };
    } catch {
      return { jobId: null, degraded: true };
    }
  }

  /** Register the extraction job handler once at module load (see routes.ts). */
  registerExtractionJobHandler(): void {
    this.container.jobs.register(CONVENTIONS_EXTRACT_JOB_KIND, async (payload) => {
      const { workspaceId, repoId } = payload as { workspaceId: string; repoId: string };
      await this.runExtraction(workspaceId, repoId);
    });
  }

  private async runExtraction(workspaceId: string, repoId: string): Promise<void> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo?.clonePath) return; // degrade silently — no clone to sample from yet

    const clonePath = repo.clonePath;
    const samplePaths = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT);
    if (samplePaths.length === 0) return;

    const files = (
      await Promise.all(
        samplePaths.map(async (path): Promise<SampledFile | null> => {
          const content = await readAndTruncate(clonePath, path);
          return content === null ? null : { path, content };
        }),
      )
    ).filter((f): f is SampledFile => f !== null);
    if (files.length === 0) return;

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(provider);
    const result = await llm.completeStructured({
      model,
      schema: ConventionExtractionSchema,
      schemaName: CONVENTION_EXTRACTION_SCHEMA_NAME,
      messages: buildConventionExtractionPrompt(repo.fullName, files),
      maxRetries: 2,
    });

    const candidates: NewConventionCandidate[] = result.data.candidates.map((c) => ({
      category: c.category,
      rule: c.rule,
      evidencePath: c.evidence_path,
      evidenceLineRange: c.evidence_line_range,
      evidenceSnippet: c.evidence_snippet,
      confidence: c.confidence,
    }));

    // Re-scan replaces only non-accepted candidates — anything the user
    // already accepted survives a background re-scan untouched.
    await this.repo.deleteUnacceptedForRepo(workspaceId, repoId);
    await this.repo.insertMany(workspaceId, repoId, candidates);
  }
}

async function readAndTruncate(clonePath: string, file: string): Promise<string | null> {
  const content = await readFile(join(clonePath, file), 'utf8').catch(() => null);
  return content === null ? null : content.slice(0, MAX_FILE_CHARS);
}
