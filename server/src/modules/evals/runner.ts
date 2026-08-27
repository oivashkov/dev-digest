import type { Provider } from '@devdigest/shared';
import { EvalExpectationArray } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { AgentRow } from '../agents/repository.js';
import type { EvalActualFinding } from './helpers.js';
import { scoreEvalCase } from './helpers.js';
import { EVAL_BATCH_JOB_KIND, EVAL_BATCH_JOB_TIMEOUT_MS } from './constants.js';
import type { EvalCaseRow, EvalsRepository } from './repository.js';

/**
 * evals runner. Calls `reviewPullRequest` DIRECTLY — never
 * `ReviewRunExecutor` — per the plan's explicit reasoning (§5): it inherits
 * `wrapUntrusted`/`INJECTION_GUARD` on the diff and PR body for free, it
 * exposes `grounding`/`dropped` for `citation_accuracy` (which
 * `Review.findings` alone cannot give — `reviewer-core/INSIGHTS.md`,
 * 2026-08-26), and it skips the repo-intel/intent enrichment ACs 26-27
 * forbid (callers digest, repo map, project-context docs, PR intent — all
 * of which would make two runs of the same frozen case incomparable against
 * the live repo's current state). It must NEVER write `reviews`/`findings`
 * rows — an eval run is not a real review.
 */

export interface RunCaseResult {
  caseId: string;
  caseName: string;
  /** The grounded findings the run produced (post-gate) — stored as-is on
   *  `eval_runs.actual_output`, never re-fed into a prompt. */
  actualOutput: unknown;
  pass: boolean;
  recall: number;
  precision: number;
  citationAccuracy: number;
  durationMs: number;
  costUsd: number | null;
}

interface EvalCaseMeta {
  pr_title?: string;
  pr_body?: string | null;
}

/** `input_meta` is untyped jsonb (AC 15) — read defensively by key, never by
 *  assuming document shape (SPEC-04 "Untrusted inputs"). */
function parseCaseMeta(inputMeta: unknown): EvalCaseMeta {
  if (!inputMeta || typeof inputMeta !== 'object') return {};
  const m = inputMeta as Record<string, unknown>;
  return {
    ...(typeof m.pr_title === 'string' ? { pr_title: m.pr_title } : {}),
    pr_body: typeof m.pr_body === 'string' ? m.pr_body : null,
  };
}

export class EvalRunner {
  constructor(
    private container: Container,
    private repo: EvalsRepository,
  ) {}

  /** Register the batch job handler once at module load (see routes.ts) —
   *  the eval kind gets its OWN, much larger timeout (plan §9): a batch of
   *  8+ sequential LLM calls routinely exceeds the JobRunner's 120s default,
   *  and `withTimeout` is a `Promise.race` that rejects without cancelling
   *  the handler — so a short timeout here wouldn't stop the spend, it would
   *  just make `jobs.status` lie about work that's still running. */
  registerJobHandler(): void {
    this.container.jobs.register(
      EVAL_BATCH_JOB_KIND,
      async (payload) => {
        const { workspaceId, agentId, batchId } = payload as {
          workspaceId: string;
          agentId: string;
          batchId: string;
        };
        await this.runBatch(workspaceId, agentId, batchId);
      },
      { timeoutMs: EVAL_BATCH_JOB_TIMEOUT_MS },
    );
  }

  /**
   * Run every eval case owned by `agentId`, persisting one `eval_runs` row
   * per case stamped with `batchId` + the agent's version read at dispatch
   * time, and publish per-case progress on the run bus keyed by `batchId`
   * (AC 23 — the same `RunBus` a live review uses, just keyed by a batch id
   * instead of a run id; `GET /runs/:id/events` does no DB lookup, so it
   * streams eval progress with no change to `reviews/`).
   *
   * A single case's failure (a bad diff, a provider error, a timeout) is
   * caught HERE, per case — it writes `pass = false` and the loop continues
   * (AC 34); it never aborts the batch or bubbles into the job runner's own
   * retry/timeout machinery.
   */
  async runBatch(workspaceId: string, agentId: string, batchId: string): Promise<void> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) {
      // Agent (or its workspace) vanished between dispatch and execution —
      // degrade silently, same contract as OnboardingService.runGeneration's
      // "no clone to ground facts in" early return. Nothing to persist to
      // and nothing to publish to (no cases were ever resolved).
      this.container.runBus.complete(batchId);
      return;
    }

    const cases = await this.repo.listCases(workspaceId, 'agent', agentId);
    for (const caseRow of cases) {
      try {
        const result = await this.runOneCase(agent, caseRow);
        await this.repo.insertRun({
          caseId: result.caseId,
          actualOutput: result.actualOutput,
          pass: result.pass,
          recall: result.recall,
          precision: result.precision,
          citationAccuracy: result.citationAccuracy,
          durationMs: result.durationMs,
          costUsd: result.costUsd,
          agentVersion: agent.version,
          batchId,
        });
        this.container.runBus.publish(
          batchId,
          'result',
          `case "${caseRow.name}": ${result.pass ? 'pass' : 'fail'}`,
          { caseId: caseRow.id, pass: result.pass },
        );
      } catch (err) {
        const message = (err as Error).message;
        this.container.runBus.publish(batchId, 'info', `case "${caseRow.name}" failed: ${message}`, {
          caseId: caseRow.id,
        });
        // Never let the fallback persistence itself take the batch down.
        await this.repo
          .insertRun({
            caseId: caseRow.id,
            actualOutput: null,
            pass: false,
            recall: 0,
            precision: 0,
            citationAccuracy: 0,
            durationMs: 0,
            costUsd: null,
            agentVersion: agent.version,
            batchId,
          })
          .catch(() => undefined);
      }
    }
    this.container.runBus.complete(batchId);
  }

  /**
   * Execute ONE case against `agent`'s own configuration and score it — no
   * persistence, no batch id, no run-bus events (the caller, either
   * `runBatch` above or the service's synchronous single-case path, owns
   * those). Throws on a genuine case-level failure (malformed `input_diff`,
   * a provider error) — every caller must catch this.
   */
  async runOneCase(agent: AgentRow, caseRow: EvalCaseRow): Promise<RunCaseResult> {
    const start = Date.now();

    // A hand-pasted diff in the case editor can be malformed — this must
    // fail as a case-level error, never an unhandled throw mid-batch (spec,
    // Edge cases). `parseUnifiedDiff` throwing here IS that case-level
    // error; the caller's try/catch is what turns it into `pass = false`.
    const diff = parseUnifiedDiff(caseRow.inputDiff ?? '');

    // `expected_output` was already validated as `EvalExpectationArray` at
    // the route boundary when the case was written (AC 48) — re-parse
    // defensively rather than trusting the stored jsonb blindly (untyped
    // column; a case created before this cap existed could in principle
    // predate it).
    const expectations = EvalExpectationArray.parse(caseRow.expectedOutput ?? []);

    const llm = await this.container.llm(agent.provider as Provider);

    // Skills are agent CONFIG, not repo-derived enrichment, so ACs 26-27
    // don't exclude them — but skills are edited independently of
    // `agents.version`, so two runs recorded at the same version can still
    // differ if skills changed in between (plan §9's "agent_version is not
    // a complete provenance key" note; accepted, not a defect to fix here).
    const skillLinks = await this.container.agentsRepo.linkedSkills(agent.id);
    const skillBodies = skillLinks
      .filter((l) => l.skill.enabled)
      .map((l) => `### ${l.skill.name}\n${l.skill.body}`);

    const meta = parseCaseMeta(caseRow.inputMeta);

    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      diff,
      llm,
      strategy: agent.strategy,
      ...(skillBodies.length > 0 ? { skills: skillBodies } : {}),
      // The case's OWN stored PR body (frozen at case-creation time), not a
      // live re-fetch — this is case data, not the repo-derived enrichment
      // ACs 26-27 forbid (callers digest / repo map / project context /
      // intent, all of which read the CURRENT repo state).
      ...(meta.pr_body ? { prDescription: meta.pr_body } : {}),
      task: `Evaluate eval case "${caseRow.name}"${meta.pr_title ? ` (from PR "${meta.pr_title}")` : ''}. Report only findings you can defend by citing an exact file and line range in the diff.`,
      sessionId: `eval:${agent.id}:${caseRow.id}`,
      // Deliberately NOT passed: callers/repoMap/intent/specs — repo-derived
      // enrichment ACs 26-27 exclude so two runs of the same frozen case
      // stay comparable regardless of the live repo's current state.
    });

    const actuals: EvalActualFinding[] = outcome.review.findings.map((f) => ({
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
    }));
    const score = scoreEvalCase(expectations, actuals, {
      kept: outcome.review.findings.length,
      dropped: outcome.dropped.length,
    });

    return {
      caseId: caseRow.id,
      caseName: caseRow.name,
      actualOutput: outcome.review.findings,
      pass: score.pass,
      recall: score.recall,
      precision: score.precision,
      citationAccuracy: score.citation_accuracy,
      durationMs: Date.now() - start,
      costUsd: outcome.costUsd,
    };
  }
}
