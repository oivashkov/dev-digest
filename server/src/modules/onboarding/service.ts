import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Onboarding, type OnboardingState, type OnboardingStatus } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { isWithinClone } from '../reviews/intent.js';
import {
  MANIFEST_PATHS,
  MAX_MANIFEST_CHARS,
  ONBOARDING_GENERATE_JOB_KIND,
  ONBOARDING_SCHEMA_NAME,
  REPO_MAP_TOKEN_BUDGET,
  TOP_FILES_N,
} from './constants.js';
import { normalizeTour, resolveLanguage } from './helpers.js';
import { buildOnboardingPrompt, OnboardingGenerationSchema, type ManifestFact } from './prompt.js';
import { OnboardingRepository } from './repository.js';

/**
 * Onboarding service. Business logic for the per-repo onboarding tour —
 * generation (LLM-driven, run as a background job, grounded strictly in
 * `repo-intel` facts) and cached retrieval. A pure READER of `repo-intel` —
 * never re-indexes (`repo-intel/README.md`).
 */
export class OnboardingService {
  private repo: OnboardingRepository;

  constructor(private container: Container) {
    this.repo = new OnboardingRepository(container.db);
  }

  /** Returns `undefined` when the repo isn't in this workspace (route → 404). */
  async getState(workspaceId: string, repoId: string): Promise<OnboardingState | undefined> {
    const repoBasics = await this.repo.getRepo(workspaceId, repoId);
    if (!repoBasics) return undefined;

    const [row, jobStatus, indexState] = await Promise.all([
      this.repo.get(repoId),
      this.repo.getJobStatus(workspaceId, repoId),
      this.container.repoIntel.getIndexState(repoId),
    ]);
    const tour = row ? row.json : null;
    const status = deriveStatus({
      hasTour: !!tour,
      sectionCount: tour?.sections.length ?? 0,
      jobStatus,
      indexFailed: indexState.status === 'failed',
    });

    return {
      tour,
      status,
      generated_at: row ? row.generatedAt.toISOString() : null,
      files_indexed: indexState.filesIndexed,
    };
  }

  /** Enqueue generation; never blocks the HTTP handler on the LLM call.
   *  202 even when refused (not-indexed / no clone) or enqueue fails — the
   *  client always polls `getState` to learn the real outcome. */
  async triggerGeneration(
    workspaceId: string,
    repoId: string,
  ): Promise<{ jobId: string | null; degraded?: boolean } | undefined> {
    const repoBasics = await this.repo.getRepo(workspaceId, repoId);
    if (!repoBasics) return undefined;

    const indexState = await this.container.repoIntel.getIndexState(repoId);
    if (indexState.status === 'failed' || !repoBasics.clonePath) {
      // Refuse to enqueue — "repo is not indexed yet" / no clone, matching
      // ConventionsService.runExtraction's clonePath guard.
      return { jobId: null, degraded: true };
    }

    const jobStatus = await this.repo.getJobStatus(workspaceId, repoId);
    if (jobStatus === 'generating') {
      // Already running — 202 without enqueuing a second job.
      return { jobId: null };
    }

    try {
      const job = await this.container.jobs.enqueue(workspaceId, ONBOARDING_GENERATE_JOB_KIND, {
        workspaceId,
        repoId,
      });
      return { jobId: job.id };
    } catch {
      return { jobId: null, degraded: true };
    }
  }

  /** Register the generation job handler once at module load (see routes.ts). */
  registerGenerationJobHandler(): void {
    this.container.jobs.register(ONBOARDING_GENERATE_JOB_KIND, async (payload) => {
      const { workspaceId, repoId } = payload as { workspaceId: string; repoId: string };
      await this.runGeneration(workspaceId, repoId);
    });
  }

  private async runGeneration(workspaceId: string, repoId: string): Promise<void> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo?.clonePath) return; // degrade silently — no clone to ground facts in
    const clonePath = repo.clonePath;

    const [criticalPaths, topFiles, repoMapResult] = await Promise.all([
      this.container.repoIntel.getCriticalPaths(repoId),
      this.container.repoIntel.getTopFilesByRank(repoId, TOP_FILES_N),
      this.container.repoIntel.getRepoMap(repoId, REPO_MAP_TOKEN_BUDGET),
    ]);

    const manifests = (
      await Promise.all(
        MANIFEST_PATHS.map(async (path): Promise<ManifestFact | null> => {
          const content = await readManifest(clonePath, path);
          return content === null ? null : { path, content };
        }),
      )
    ).filter((m): m is ManifestFact => m !== null);

    const language = await resolveLanguage(this.container, workspaceId);
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding');
    const llm = await this.container.llm(provider);
    const result = await llm.completeStructured({
      model,
      schema: OnboardingGenerationSchema,
      schemaName: ONBOARDING_SCHEMA_NAME,
      messages: await buildOnboardingPrompt(
        repo.fullName,
        { criticalPaths, topFiles, repoMap: repoMapResult.text, manifests },
        language,
      ),
      maxRetries: 2,
    });

    // Allowed link set = the repo's indexed file set (getFileRank hits over
    // every path shown to the model) UNION the manifest paths actually fed —
    // manifests aren't in `file_rank` (the walker only indexes SUPPORTED_EXT
    // source files), so without the union every local_setup link would be
    // dropped (SPEC-02 plan §9 Recommendation 1).
    const candidatePaths = [...topFiles, ...criticalPaths.flat()];
    const rankHits = await this.container.repoIntel.getFileRank(repoId, candidatePaths);
    const allowedPaths = new Set<string>([
      ...rankHits.map((r) => r.path),
      ...manifests.map((m) => m.path),
    ]);

    const normalized = normalizeTour(result.data, allowedPaths);
    const tour = Onboarding.parse(normalized); // strict persistence gate

    try {
      await this.repo.upsert(repoId, tour);
    } catch {
      // Repo deleted mid-job (FK cascade removed the parent row this insert
      // now conflicts with) — the job's write must tolerate that silently.
    }
  }
}

async function readManifest(clonePath: string, path: string): Promise<string | null> {
  if (!isWithinClone(clonePath, path)) return null;
  const content = await readFile(join(clonePath, path), 'utf8').catch(() => null);
  return content === null ? null : content.slice(0, MAX_MANIFEST_CHARS);
}

/**
 * Precedence when more than one condition applies (highest first):
 * not_indexed > generating > partial > ready > failed > empty.
 */
function deriveStatus(input: {
  hasTour: boolean;
  sectionCount: number;
  jobStatus: 'idle' | 'generating' | 'failed';
  indexFailed: boolean;
}): OnboardingStatus {
  if (input.indexFailed) return 'not_indexed';
  if (input.jobStatus === 'generating') return 'generating';
  if (input.hasTour && input.sectionCount < 5) return 'partial';
  if (input.hasTour) return 'ready';
  if (input.jobStatus === 'failed') return 'failed';
  return 'empty';
}
