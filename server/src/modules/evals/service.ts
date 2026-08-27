import { randomUUID } from 'node:crypto';
import type {
  EvalCase,
  EvalDashboard,
  EvalExpectationArray,
  EvalOwnerKind,
  EvalRun,
  EvalRunRecord,
  EvalRunResult,
  EvalTrendPoint,
  FindingCategory,
  Severity,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../agents/repository.js';
import { deriveEvalCaseName } from './helpers.js';
import { EVAL_BATCH_JOB_KIND } from './constants.js';
import { EvalsRepository, type EvalCaseRow, type EvalRunJoinedRow } from './repository.js';
import { EvalRunner, type RunCaseResult } from './runner.js';

/**
 * evals service. Business rules for the evals module (SPEC-04): case CRUD
 * with the `(owner_id, name)` conflict rule, the finding→case idempotent
 * path, dispatching/reading a batch, and the dashboard aggregation. Never
 * imports `fastify` or touches `drizzle-orm` directly — every DB access
 * goes through `EvalsRepository`; every LLM call goes through `EvalRunner`.
 */

/** Recent-run rows shown on the dashboard — capped so a long-lived agent's
 *  full history never inflates the payload; not itself an AC, just a sane
 *  bound (no cap is specified in the spec). */
const RECENT_RUNS_LIMIT = 20;

const EMPTY_AGGREGATE: EvalRun = {
  recall: 0,
  precision: 0,
  citation_accuracy: 0,
  traces_passed: 0,
  traces_total: 0,
  duration_ms: 0,
  cost_usd: null,
  per_trace: [],
};

/** Properly-typed case create/update input — `expected_output` is validated
 *  as `EvalExpectationArray` at the ROUTE boundary (AC 48; the given
 *  `EvalCaseInput.expected_output` contract field stays `z.unknown()`, so
 *  routes.ts extends it locally with the stricter array schema for request
 *  validation only). By the time this reaches the service it is already a
 *  real `EvalExpectation[]`, not `unknown`. */
export interface EvalCaseServiceInput {
  name: string;
  input_diff: string;
  input_files?: unknown;
  input_meta?: unknown;
  expected_output: EvalExpectationArray;
  notes?: string | null;
}

/** No `@devdigest/shared` contract models this envelope (the `jobs` table
 *  has no result column — see the spec's "Non-functional requirements");
 *  mirrors `hooks/evals.ts`'s locally-declared `EvalBatchStatus` shape
 *  field-for-field so Step 9's UI needs no follow-up fix. */
export interface EvalBatchStatusDto {
  status: 'queued' | 'running' | 'done' | 'failed';
  batch_id: string;
  result: EvalRun | null;
  error?: string | null;
}

function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalOwnerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes,
  };
}

function toEvalRunRecordDto(row: EvalRunJoinedRow): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: row.caseName,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
    agent_version: row.agentVersion,
    batch_id: row.batchId,
  };
}

/** `pr_files.patch` reconstructed for exactly ONE file (AC 11) — same
 *  synthetic-diff-header shape `diff-loader.ts#diffFromPrFiles` builds for a
 *  whole PR, just scoped to a single path here. */
function buildSingleFileDiff(file: string, patch: string): string {
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, patch].join('\n');
}

/** Groups a chronological `eval_runs` list into "runs" — a shared
 *  `batch_id`, or a lone `batch_id IS NULL` row from a single-case sync run
 *  treated as its own run of one case — sorted oldest-first by the group's
 *  latest row. This is what the dashboard's trend/current/delta are
 *  actually computed over (AC 53, 64), distinct from `recent_runs`, which
 *  stays at CASE granularity. */
interface RunGroup {
  ranAt: Date;
  rows: EvalRunJoinedRow[];
}
function groupRuns(rows: EvalRunJoinedRow[]): RunGroup[] {
  const map = new Map<string, RunGroup>();
  for (const row of rows) {
    const key = row.batchId ?? `single:${row.id}`;
    const existing = map.get(key);
    if (existing) {
      existing.rows.push(row);
      if (row.ranAt > existing.ranAt) existing.ranAt = row.ranAt;
    } else {
      map.set(key, { ranAt: row.ranAt, rows: [row] });
    }
  }
  return [...map.values()].sort((a, b) => a.ranAt.getTime() - b.ranAt.getTime());
}

function mean(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Aggregate metrics for one run — one batch's rows, or a single synchronous
 *  case run's one-row array (AC 31: derived by grouping at read time, never
 *  persisted as a second row). */
function buildAggregate(rows: EvalRunJoinedRow[]): EvalRun {
  if (rows.length === 0) return EMPTY_AGGREGATE;
  const tracesTotal = rows.length;
  const tracesPassed = rows.filter((r) => r.pass === true).length;
  const costs = rows.map((r) => r.costUsd);
  const costUsd = costs.every((c) => c == null)
    ? null
    : costs.reduce<number>((sum, c) => sum + (c ?? 0), 0);
  return {
    recall: mean(rows.map((r) => r.recall ?? 0)),
    precision: mean(rows.map((r) => r.precision ?? 0)),
    citation_accuracy: mean(rows.map((r) => r.citationAccuracy ?? 0)),
    traces_passed: tracesPassed,
    traces_total: tracesTotal,
    duration_ms: rows.reduce((sum, r) => sum + (r.durationMs ?? 0), 0),
    cost_usd: costUsd,
    per_trace: rows.map((r) => ({
      name: r.caseName,
      pass: r.pass ?? false,
      expected: r.expectedOutput,
      actual: r.actualOutput,
    })),
  };
}

function toTrendPoint(group: RunGroup): EvalTrendPoint {
  const agg = buildAggregate(group.rows);
  return {
    ran_at: group.ranAt.toISOString(),
    recall: agg.recall,
    precision: agg.precision,
    citation_accuracy: agg.citation_accuracy,
    pass_rate: agg.traces_total === 0 ? 0 : agg.traces_passed / agg.traces_total,
    cost_usd: agg.cost_usd,
  };
}

export class EvalsService {
  constructor(
    private container: Container,
    private repo: EvalsRepository,
    private runner: EvalRunner,
  ) {}

  // ---- Cases (ACs 2-7) ---------------------------------------------------

  /** `undefined` when the agent isn't in this workspace (route → 404, AC 6). */
  async listCasesForAgent(workspaceId: string, agentId: string): Promise<EvalCase[] | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listCases(workspaceId, 'agent', agentId);
    return rows.map(toEvalCaseDto);
  }

  /**
   * Owner is always taken from the PATH (`agentId`), never trusted from the
   * request body — `EvalCaseInput` carries `owner_kind`/`owner_id` fields
   * (given contract shape) but this route is already agent-scoped by `:id`.
   * Trusting a body-supplied `owner_id` instead would be an IDOR vector: a
   * case whose `owner_id` doesn't match the addressed agent, and since
   * `eval_cases.owner_id` has no FK (bare uuid — spec's Edge cases), nothing
   * at the DB level would catch that mismatch either.
   */
  async createCase(
    workspaceId: string,
    agentId: string,
    input: EvalCaseServiceInput,
  ): Promise<EvalCase> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output,
      notes: input.notes,
    });
    if (!row) {
      throw new AppError(
        'duplicate_case_name',
        `An eval case named "${input.name}" already exists for this agent`,
        409,
      );
    }
    return toEvalCaseDto(row);
  }

  /**
   * `undefined` when the case isn't in this workspace (route → 404, AC 6).
   * Never lets a PUT move a case to a different owner — the wire body's
   * `owner_kind`/`owner_id` are ignored on update, same IDOR reasoning as
   * `createCase` above, just for reassignment instead of initial creation.
   */
  async updateCase(
    workspaceId: string,
    id: string,
    input: EvalCaseServiceInput,
  ): Promise<EvalCase | undefined> {
    const existing = await this.repo.getCase(workspaceId, id);
    if (!existing) return undefined;

    if (input.name !== existing.name) {
      const conflict = await this.repo.findByOwnerAndName(existing.ownerId, input.name);
      if (conflict && conflict.id !== id) {
        throw new AppError(
          'duplicate_case_name',
          `An eval case named "${input.name}" already exists for this owner`,
          409,
        );
      }
    }

    const row = await this.repo.updateCase(workspaceId, id, {
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output,
      notes: input.notes,
    });
    return row ? toEvalCaseDto(row) : undefined;
  }

  /** `eval_runs` cascades with the case (AC 5) — nothing else to clean up. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, id);
  }

  // ---- Finding → case (ACs 8-18) -----------------------------------------

  /**
   * `undefined` when the finding isn't in this workspace (route → 404,
   * matching `actOnFinding`'s existing cross-workspace behavior,
   * `reviews/findings.ts:18-20`). `created: false` on the idempotent
   * repeat-click path (AC 14) — the route always responds `200` either way.
   */
  async createCaseFromFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<{ case: EvalCase; created: boolean } | undefined> {
    const ctx = await this.repo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) return undefined;

    if (!ctx.agentId) {
      throw new AppError(
        'finding_no_agent',
        "This finding's review has no attributable agent (the agent was deleted)",
        400,
      );
    }
    const expect: 'must_find' | 'must_not_flag' | null = ctx.finding.acceptedAt
      ? 'must_find'
      : ctx.finding.dismissedAt
        ? 'must_not_flag'
        : null;
    if (!expect) {
      throw new AppError(
        'finding_not_actioned',
        'Accept or dismiss this finding before turning it into an eval case',
        400,
      );
    }
    if (!ctx.filePatch) {
      throw new AppError(
        'finding_missing_patch',
        `No stored patch text for "${ctx.finding.file}" — cannot build a case diff`,
        400,
      );
    }

    const name = deriveEvalCaseName(ctx.finding.title, ctx.finding.file, ctx.finding.startLine);

    const existing = await this.repo.findByOwnerAndName(ctx.agentId, name);
    if (existing) return { case: toEvalCaseDto(existing), created: false };

    const inputDiff = buildSingleFileDiff(ctx.finding.file, ctx.filePatch);
    const expectedOutput: EvalExpectationArray = [
      {
        expect,
        file: ctx.finding.file,
        start_line: ctx.finding.startLine,
        end_line: ctx.finding.endLine,
        severity: ctx.finding.severity as Severity,
        category: ctx.finding.category as FindingCategory,
        title: ctx.finding.title,
      },
    ];
    const inputMeta = {
      pr_title: ctx.pull.title,
      pr_body: ctx.pull.body,
      pr_number: ctx.pull.number,
      source_pr_id: ctx.pull.id,
      source_head_sha: ctx.pull.headSha,
    };

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: ctx.agentId,
      name,
      inputDiff,
      inputMeta,
      expectedOutput,
      notes: null,
    });
    if (row) return { case: toEvalCaseDto(row), created: true };

    // Lost a race against a concurrent click on the same finding — AC 14's
    // idempotency must hold under concurrency too, not just a single
    // caller's repeat click.
    const winner = await this.repo.findByOwnerAndName(ctx.agentId, name);
    if (winner) return { case: toEvalCaseDto(winner), created: false };
    throw new AppError(
      'eval_case_create_race',
      'Failed to create or find the eval case for this finding',
      500,
    );
  }

  // ---- Running (ACs 19-34) -------------------------------------------------

  /** `undefined` when the case isn't in this workspace (route → 404). Never
   *  throws on a case-level execution failure — degrades to a `pass: false`
   *  result, same as the batch path's per-case catch (AC 34's spirit
   *  applied to the synchronous single-case route too). */
  async runSingleCase(workspaceId: string, caseId: string): Promise<EvalRunResult | undefined> {
    const caseRow = await this.repo.getCase(workspaceId, caseId);
    if (!caseRow) return undefined;
    if (caseRow.ownerKind !== 'agent') {
      throw new AppError(
        'unsupported_owner_kind',
        'Only agent-owned eval cases can be run (skill evals are out of scope for this build)',
        400,
      );
    }
    const agent = await this.container.agentsRepo.getById(workspaceId, caseRow.ownerId);
    if (!agent) throw new NotFoundError('The agent that owns this eval case no longer exists');

    let result: RunCaseResult;
    try {
      result = await this.runner.runOneCase(agent, caseRow);
    } catch {
      result = {
        caseId: caseRow.id,
        caseName: caseRow.name,
        actualOutput: null,
        pass: false,
        recall: 0,
        precision: 0,
        citationAccuracy: 0,
        durationMs: 0,
        costUsd: null,
      };
    }

    const runRow = await this.repo.insertRun({
      caseId: result.caseId,
      actualOutput: result.actualOutput,
      pass: result.pass,
      recall: result.recall,
      precision: result.precision,
      citationAccuracy: result.citationAccuracy,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
      agentVersion: agent.version,
      batchId: null,
    });

    const joined: EvalRunJoinedRow = {
      id: runRow.id,
      caseId: caseRow.id,
      caseName: caseRow.name,
      expectedOutput: caseRow.expectedOutput,
      actualOutput: result.actualOutput,
      pass: result.pass,
      recall: result.recall,
      precision: result.precision,
      citationAccuracy: result.citationAccuracy,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
      agentVersion: agent.version,
      batchId: null,
      ranAt: runRow.ranAt,
    };
    return { run_id: runRow.id, case_id: caseRow.id, result: buildAggregate([joined]) };
  }

  /** `undefined` when the agent isn't in this workspace (route → 404).
   *  Throws `400` (AC 33) — never enqueues, never issues an LLM call —
   *  when the agent has zero eval cases. */
  async dispatchBatch(
    workspaceId: string,
    agentId: string,
  ): Promise<{ jobId: string; batchId: string } | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const cases = await this.repo.listCases(workspaceId, 'agent', agentId);
    if (cases.length === 0) {
      throw new AppError('no_eval_cases', 'This agent has no eval cases to run', 400);
    }

    const batchId = randomUUID();
    const job = await this.container.jobs.enqueue(workspaceId, EVAL_BATCH_JOB_KIND, {
      workspaceId,
      agentId,
      batchId,
    });
    return { jobId: job.id, batchId };
  }

  /**
   * `undefined` when the agent isn't in this workspace (route → 404).
   * Completion is derived from `eval_runs` ROWS ON DISK for this
   * `batch_id`, not from `jobs.status` alone (plan §9) — `jobs.status`
   * is consulted only while there aren't yet enough rows to call it done.
   */
  async getBatchStatus(
    workspaceId: string,
    agentId: string,
    batchId: string,
  ): Promise<EvalBatchStatusDto | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const cases = await this.repo.listCases(workspaceId, 'agent', agentId);
    const runs = await this.repo.listRunsForBatch(batchId);
    const caseIds = new Set(cases.map((c) => c.id));
    const relevantRuns = runs.filter((r) => caseIds.has(r.caseId));

    if (cases.length > 0 && relevantRuns.length >= cases.length) {
      return { status: 'done', batch_id: batchId, result: buildAggregate(relevantRuns) };
    }

    const job = await this.repo.getBatchJobStatus(workspaceId, batchId);
    if (job.status === 'failed') {
      return { status: 'failed', batch_id: batchId, result: null, error: job.error };
    }
    if (job.status === 'running') {
      return { status: 'running', batch_id: batchId, result: null };
    }
    // 'queued' or 'unknown' (the job row isn't visible in the 20-row window
    // yet, or `enqueue()`'s DB insert hasn't been read back yet) — both
    // read as still-pending, the safe default (AC 21).
    return { status: 'queued', batch_id: batchId, result: null };
  }

  // ---- Dashboards (ACs 60-67) ----------------------------------------------

  /** `undefined` when the agent isn't in this workspace (route → 404). */
  async getAgentDashboard(
    workspaceId: string,
    agentId: string,
    since?: Date,
  ): Promise<EvalDashboard | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    return this.buildDashboard(agent, workspaceId, since);
  }

  /**
   * One `EvalDashboard` per ENABLED agent in the workspace (AC 61, 70) —
   * iterating `agentsRepo.listEnabled` rather than distinct `eval_cases`
   * owner ids means a case whose agent was deleted (`owner_id` has no FK,
   * spec's Edge cases: "orphaned cases") never surfaces as a nameless row;
   * it's simply skipped, per the plan's Open Questions resolution.
   */
  async getWorkspaceDashboard(workspaceId: string, since?: Date): Promise<EvalDashboard[]> {
    const agents = await this.container.agentsRepo.listEnabled(workspaceId);
    return Promise.all(agents.map((agent) => this.buildDashboard(agent, workspaceId, since)));
  }

  private async buildDashboard(
    agent: AgentRow,
    workspaceId: string,
    since?: Date,
  ): Promise<EvalDashboard> {
    const cases = await this.repo.listCases(workspaceId, 'agent', agent.id);
    const runs = await this.repo.listRunRecordsForOwner(workspaceId, 'agent', agent.id, since);
    const groups = groupRuns(runs);

    const trend = groups.map(toTrendPoint);
    const currentGroup = groups.at(-1);
    const previousGroup = groups.at(-2);

    const currentAgg = currentGroup ? buildAggregate(currentGroup.rows) : EMPTY_AGGREGATE;
    // AC 65: exactly one recorded run ⇒ every delta field is 0. Falls out
    // naturally here (no previous group ⇒ delta all zero), same branch as
    // zero recorded runs.
    const previousAgg = previousGroup ? buildAggregate(previousGroup.rows) : null;
    const delta = previousAgg
      ? {
          recall: currentAgg.recall - previousAgg.recall,
          precision: currentAgg.precision - previousAgg.precision,
          citation_accuracy: currentAgg.citation_accuracy - previousAgg.citation_accuracy,
        }
      : { recall: 0, precision: 0, citation_accuracy: 0 };

    // AC 66's exact wording isn't spec-mandated (unlike AC 59's literal
    // "Promote prompt & model vN") — only that it name the metric, the
    // magnitude of the drop, and the version. `currentGroup`'s rows all
    // share one dispatch, so they share one `agent_version` in practice;
    // falling back to the agent's live version covers the (should-be-rare)
    // case of a null-`agent_version` row predating that column.
    const currentVersion = currentGroup?.rows[0]?.agentVersion ?? agent.version;
    const alert =
      delta.precision < 0
        ? `precision dropped ${(Math.abs(delta.precision) * 100).toFixed(0)}% on v${currentVersion}`
        : null;

    const recentRuns = [...runs]
      .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
      .slice(0, RECENT_RUNS_LIMIT)
      .map(toEvalRunRecordDto);

    return {
      owner_kind: 'agent',
      owner_id: agent.id,
      cases_total: cases.length,
      current: {
        recall: currentAgg.recall,
        precision: currentAgg.precision,
        citation_accuracy: currentAgg.citation_accuracy,
        traces_passed: currentAgg.traces_passed,
        traces_total: currentAgg.traces_total,
        cost_usd: currentAgg.cost_usd,
      },
      delta,
      trend,
      recent_runs: recentRuns,
      alert,
    };
  }
}
