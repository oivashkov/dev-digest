import { MAX_CONTEXT_DOCS, type SpecRead } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { RunLogger } from '../../platform/run-logger.js';
import type * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { LinkedSkillRow } from '../agents/repository.js';
import { isSafeContextDocPath, normalizeContextPath } from '../context/helpers.js';
import { MAX_CONTEXT_DOC_CHARS, MAX_CONTEXT_TOTAL_CHARS } from './constants.js';

/**
 * Project Context run-time injection (SPEC-01). `buildProjectContextDocs`
 * sits alongside `run-executor.ts`'s `buildCallersDigest`/`buildRepoMapDigest`
 * and follows their EXACT degrade contract: never throws, and a caller with
 * nothing to inject gets back an empty result so the assembled prompt is
 * byte-identical to today's (the acceptance bar: "with zero attachments the
 * assembled prompt is byte-identical to a run with the feature absent").
 */

type RepoRow = typeof schema.repos.$inferSelect;

export interface ProjectContextResult {
  /** Document texts, in the exact order they should be injected — index N
   *  here corresponds to index N of `specsRead` AND to `spec-N` in the
   *  engine's `wrapUntrusted` label (reviewer-core/src/prompt.ts). */
  specs: string[];
  specsRead: SpecRead[];
}

const EMPTY: ProjectContextResult = { specs: [], specsRead: [] };

/**
 * Resolve, read, and cap an agent's assembled project-context document set
 * for one run.
 *
 * Order of operations matters (SPEC-01 acceptance criteria):
 *  1. Restrict to attachments whose stored `repo_id` matches the run's repo
 *     — done FIRST, by construction: `AgentsRepository.contextDocs`/
 *     `SkillsRepository.contextDocs` are both already scoped by `(*, repoId)`
 *     in their SQL `WHERE`, so a repo-A attachment never even reaches this
 *     function for a repo-B run (Q2).
 *  2. Union agent-level (drag order) + enabled-skill-inherited (linked-skill
 *     order) attachments, deduplicated by normalized path, agent-first (Q3).
 *  3. Cap at `MAX_CONTEXT_DOCS` (Q8) — drop the rest, log each dropped path,
 *     BEFORE reading anything (no wasted reads on documents that won't ship).
 *  4. Re-guard each surviving path against the clone (untrusted on the way
 *     back out of the DB too — SPEC-01 "Untrusted inputs") and read it
 *     fresh via `container.git.readFile`.
 *  5. Truncate per-document at `MAX_CONTEXT_DOC_CHARS` and the whole block at
 *     `MAX_CONTEXT_TOTAL_CHARS`, logging every failed/dropped/truncated path.
 */
export async function buildProjectContextDocs(
  container: Container,
  agent: AgentRow,
  repo: RepoRow,
  skillLinks: LinkedSkillRow[],
  runLog: RunLogger,
): Promise<ProjectContextResult> {
  if (!repo.clonePath) return EMPTY;
  const clonePath = repo.clonePath;

  try {
    const agentDocs = await container.agentsRepo.contextDocs(agent.id, repo.id);

    const skillDocs: { path: string }[] = [];
    for (const link of skillLinks) {
      if (!link.skill.enabled) continue; // mirrors the skill-body filter above
      const docs = await container.skillsRepo.contextDocs(link.skill.id, repo.id);
      skillDocs.push(...docs);
    }

    const seen = new Set<string>();
    const merged: string[] = [];
    for (const d of [...agentDocs, ...skillDocs]) {
      const norm = normalizeContextPath(d.path);
      if (seen.has(norm)) continue;
      seen.add(norm);
      merged.push(d.path);
    }
    if (merged.length === 0) return EMPTY;

    const kept = merged.slice(0, MAX_CONTEXT_DOCS);
    for (const path of merged.slice(MAX_CONTEXT_DOCS)) {
      runLog.info(`project context: dropped "${path}" — over the ${MAX_CONTEXT_DOCS}-document cap`);
    }

    const specs: string[] = [];
    const specsRead: SpecRead[] = [];
    let totalChars = 0;

    for (const path of kept) {
      if (!isSafeContextDocPath(clonePath, path)) {
        runLog.info(`project context: "${path}" failed the path guard — skipped`);
        continue;
      }
      if (totalChars >= MAX_CONTEXT_TOTAL_CHARS) {
        runLog.info(`project context: dropped "${path}" — over the ~${MAX_CONTEXT_TOTAL_CHARS}-char block budget`);
        continue;
      }

      let content: string;
      try {
        content = await container.git.readFile(repo, path);
      } catch (err) {
        runLog.info(`project context: failed to read "${path}" — ${(err as Error).message}`);
        continue;
      }

      const overDocCap = content.length > MAX_CONTEXT_DOC_CHARS;
      let text = overDocCap ? content.slice(0, MAX_CONTEXT_DOC_CHARS) : content;
      const remainingBudget = MAX_CONTEXT_TOTAL_CHARS - totalChars;
      const overTotalBudget = text.length > remainingBudget;
      if (overTotalBudget) text = text.slice(0, remainingBudget);
      totalChars += text.length;

      specs.push(text);
      specsRead.push({
        path,
        tokens: container.tokenizer.count(text),
        truncated: overDocCap || overTotalBudget,
      });
    }

    if (specs.length > 0) {
      runLog.info(`project context: ${specs.length} document(s) attached`);
    }
    return { specs, specsRead };
  } catch (err) {
    // Never let this enrichment break the run — same degrade contract as
    // buildCallersDigest/buildRepoMapDigest.
    runLog.info(`project context: failed — ${(err as Error).message}`);
    return EMPTY;
  }
}
