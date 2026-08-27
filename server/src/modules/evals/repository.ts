import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalOwnerKind } from '@devdigest/shared';
import { EVAL_BATCH_JOB_KIND } from './constants.js';

/**
 * evals data-access. The ONLY `drizzle-orm` surface for `eval_cases` and
 * `eval_runs` (SPEC-04, `backend-onion-architecture`). It also does a small
 * amount of READ-ONLY cross-table joining — `findingContext` walks
 * finding → review → pull_request → pr_files to build a case from a finding
 * (ACs 11/12/15/16) — the plan calls this out explicitly as this file's job;
 * it never writes to those tables.
 *
 * Workspace scoping: `eval_cases.workspace_id` is a direct column, stamped at
 * create time. `eval_runs` has no workspace column of its own — every read
 * here reaches it THROUGH `eval_cases` (join or a pre-resolved case-id set),
 * never bare (SPEC-04 "Untrusted inputs" — cross-workspace access).
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

export interface NewEvalCase {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput: unknown;
  notes?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface NewEvalRun {
  caseId: string;
  actualOutput: unknown;
  pass: boolean;
  recall: number;
  precision: number;
  citationAccuracy: number;
  durationMs: number;
  costUsd: number | null;
  agentVersion: number | null;
  batchId: string | null;
}

/** An `eval_runs` row joined with its case's `name` + `expected_output` — the
 *  shape both the batch aggregate (`per_trace`) and the dashboard's
 *  `recent_runs` are built from. */
export interface EvalRunJoinedRow {
  id: string;
  caseId: string;
  caseName: string;
  expectedOutput: unknown;
  actualOutput: unknown;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
  agentVersion: number | null;
  batchId: string | null;
  ranAt: Date;
}

/** Resolved context for `POST /findings/:id/eval-case` (ACs 9-18). */
export interface EvalFindingContext {
  finding: {
    id: string;
    file: string;
    startLine: number;
    endLine: number;
    title: string;
    severity: string;
    category: string;
    acceptedAt: Date | null;
    dismissedAt: Date | null;
  };
  /** The agent that produced this finding's review; null when the review's
   *  `agent_id` was cleared (agent deleted, `reviews.agentId` is `set null`). */
  agentId: string | null;
  pull: {
    id: string;
    workspaceId: string;
    number: number;
    title: string;
    body: string | null;
    headSha: string;
  };
  /** `pr_files.patch` for THIS finding's file only (AC 11) — null when no
   *  patch was ever stored for that file (AC 18). */
  filePatch: string | null;
}

export type EvalBatchJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'unknown';

function toJoinedRow(row: { evalRuns: EvalRunRow; evalCases: EvalCaseRow }): EvalRunJoinedRow {
  return {
    id: row.evalRuns.id,
    caseId: row.evalRuns.caseId,
    caseName: row.evalCases.name,
    expectedOutput: row.evalCases.expectedOutput,
    actualOutput: row.evalRuns.actualOutput,
    pass: row.evalRuns.pass,
    recall: row.evalRuns.recall,
    precision: row.evalRuns.precision,
    citationAccuracy: row.evalRuns.citationAccuracy,
    durationMs: row.evalRuns.durationMs,
    costUsd: row.evalRuns.costUsd,
    agentVersion: row.evalRuns.agentVersion,
    batchId: row.evalRuns.batchId,
    ranAt: row.evalRuns.ranAt,
  };
}

export class EvalsRepository {
  constructor(private db: Db) {}

  // ---- Cases (ACs 2-7) ---------------------------------------------------

  async listCases(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  /** Looked up by the deterministic finding→case name (AC 14) and by the
   *  regular create/rename conflict check (AC 7) — same uniqueness key. */
  async findByOwnerAndName(ownerId: string, name: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerId, ownerId), eq(t.evalCases.name, name)));
    return row;
  }

  /**
   * Insert a case. Race-safe conflict detection (AC 7) via
   * `onConflictDoNothing` against the `(owner_id, name)` unique index rather
   * than a check-then-insert — mirrors `AgentsRepository.setSkills`'s
   * `onConflictDoUpdate` reasoning (`server/INSIGHTS.md`, 2026-08-12): a
   * plain check-then-insert has a race window two concurrent callers can
   * both pass. Returns `undefined` when the row already existed — the
   * SERVICE decides what that means (409 for a direct create, "return the
   * existing row" for the finding→case idempotent path).
   */
  async insertCase(values: NewEvalCase): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputFiles: (values.inputFiles ?? null) as object | null,
        inputMeta: (values.inputMeta ?? null) as object | null,
        expectedOutput: values.expectedOutput as object,
        notes: values.notes ?? null,
      })
      .onConflictDoNothing()
      .returning();
    return row;
  }

  /** Never touches `owner_kind`/`owner_id` — a case's owner is fixed at
   *  creation (see `service.ts`'s `updateCase` doc comment for why). */
  async updateCase(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles as object | null } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta as object | null } : {}),
        ...(patch.expectedOutput !== undefined
          ? { expectedOutput: patch.expectedOutput as object }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  /** `eval_runs` cascades on `case_id` (AC 5) — nothing extra to delete here. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- Finding → case (ACs 9-18) -----------------------------------------

  async findingContext(findingId: string): Promise<EvalFindingContext | undefined> {
    const [row] = await this.db
      .select({ finding: t.findings, review: t.reviews, pull: t.pullRequests })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.pullRequests, eq(t.reviews.prId, t.pullRequests.id))
      .where(eq(t.findings.id, findingId));
    if (!row) return undefined;

    const [fileRow] = await this.db
      .select({ patch: t.prFiles.patch })
      .from(t.prFiles)
      .where(and(eq(t.prFiles.prId, row.pull.id), eq(t.prFiles.path, row.finding.file)));

    return {
      finding: {
        id: row.finding.id,
        file: row.finding.file,
        startLine: row.finding.startLine,
        endLine: row.finding.endLine,
        title: row.finding.title,
        severity: row.finding.severity,
        category: row.finding.category,
        acceptedAt: row.finding.acceptedAt,
        dismissedAt: row.finding.dismissedAt,
      },
      agentId: row.review.agentId,
      pull: {
        id: row.pull.id,
        workspaceId: row.pull.workspaceId,
        number: row.pull.number,
        title: row.pull.title,
        body: row.pull.body,
        headSha: row.pull.headSha,
      },
      filePatch: fileRow?.patch ?? null,
    };
  }

  // ---- Runs ----------------------------------------------------------------

  async insertRun(values: NewEvalRun): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        actualOutput: values.actualOutput as object | null,
        pass: values.pass,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
        agentVersion: values.agentVersion,
        batchId: values.batchId,
      })
      .returning();
    return row!;
  }

  /** Every `eval_runs` row stamped with `batchId`, joined with its case's
   *  name + expected_output (AC 31 — grouped on `batch_id` at read time,
   *  never persisted as a second aggregate row). */
  async listRunsForBatch(batchId: string): Promise<EvalRunJoinedRow[]> {
    const rows = await this.db
      .select({ evalRuns: t.evalRuns, evalCases: t.evalCases })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(eq(t.evalRuns.batchId, batchId));
    return rows.map(toJoinedRow);
  }

  /**
   * Every `eval_runs` row for an owner's case set, oldest first — the raw
   * material the dashboard groups into "runs" (a shared `batch_id`, or a
   * lone `batch_id IS NULL` row from a single-case sync run) and trend
   * points. Scoped THROUGH `eval_cases` (workspace + owner), never a bare
   * `eval_runs` scan, since `eval_runs` itself carries no workspace column.
   */
  async listRunRecordsForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
    since?: Date,
  ): Promise<EvalRunJoinedRow[]> {
    const caseIds = (await this.listCases(workspaceId, ownerKind, ownerId)).map((c) => c.id);
    if (caseIds.length === 0) return [];
    const rows = await this.db
      .select({ evalRuns: t.evalRuns, evalCases: t.evalCases })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          inArray(t.evalRuns.caseId, caseIds),
          ...(since ? [gte(t.evalRuns.ranAt, since)] : []),
        ),
      )
      .orderBy(t.evalRuns.ranAt);
    return rows.map(toJoinedRow);
  }

  // ---- Batch job status (fallback while no `eval_runs` row exists yet) ----

  /**
   * Status of the newest `eval-batch` job whose payload carries this
   * `batchId`, scoped to the workspace — same 20-row-window approach as
   * `OnboardingRepository.getJobStatus` (copied deliberately for
   * consistency, same known limitation: a workspace with 20+ eval-batch
   * jobs enqueued since this one falls outside the window and reads as
   * `unknown`). Only consulted for the `queued`/`running`/pre-any-row
   * `failed` states (plan §9) — once `eval_runs` rows exist, the service
   * derives completion from THEM, not from this.
   */
  async getBatchJobStatus(
    workspaceId: string,
    batchId: string,
  ): Promise<{ status: EvalBatchJobStatus; error: string | null }> {
    const rows = await this.db
      .select({ status: t.jobs.status, payload: t.jobs.payload, error: t.jobs.error })
      .from(t.jobs)
      .where(and(eq(t.jobs.workspaceId, workspaceId), eq(t.jobs.kind, EVAL_BATCH_JOB_KIND)))
      .orderBy(desc(t.jobs.scheduledAt))
      .limit(20);
    const latest = rows.find((r) => (r.payload as { batchId?: string } | null)?.batchId === batchId);
    if (!latest) return { status: 'unknown', error: null };
    return { status: latest.status as EvalBatchJobStatus, error: latest.error };
  }
}
