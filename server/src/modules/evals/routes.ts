import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseInput, EvalExpectationArray } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalsRepository } from './repository.js';
import { EvalRunner } from './runner.js';
import { EvalsService } from './service.js';
import { EVAL_RUN_RATE_LIMIT } from './constants.js';

/**
 * evals module (SPEC-04).
 *   GET    /agents/:id/eval-cases          → this agent's case set (workspace-scoped)
 *   POST   /agents/:id/eval-cases          → create a case owned by this agent
 *   PUT    /eval-cases/:id                 → update a case
 *   DELETE /eval-cases/:id                 → delete a case (+ its eval_runs, cascade)
 *   POST   /eval-cases/:id/run             → run ONE case synchronously
 *   POST   /findings/:id/eval-case         → turn an accepted/dismissed finding into a case.
 *                                             NOTE: despite the `/findings/:id/*` prefix
 *                                             otherwise belonging to `reviews/routes.ts`
 *                                             (accept/dismiss), THIS route is owned by
 *                                             `evals/` — `reviews/` is not modified by
 *                                             this module at all (SPEC-04, "Module
 *                                             ownership of POST /findings/:id/eval-case").
 *   POST   /agents/:id/eval-runs           → dispatch an async batch run (202 + job id + batch_id)
 *   GET    /agents/:id/eval-runs/:batchId  → batch status / aggregate result
 *   GET    /agents/:id/eval-dashboard      → this agent's EvalDashboard
 *   GET    /eval-dashboard                 → one EvalDashboard per enabled agent in the workspace
 *
 * Onion layering: this file is status-codes-only. Business rules live in
 * `service.ts`; the LLM-calling execution path lives in `runner.ts`;
 * `repository.ts` is the only `drizzle-orm` surface for `eval_cases`/`eval_runs`.
 */

/** `EvalCaseInput.expected_output` is `z.unknown()` on the given shared
 *  contract (AC 48's boundary check lives HERE, not on that contract —
 *  spec's "Contract copies" note: the given field is not reshaped). Extends
 *  rather than redeclares (`zod` skill's `object-extend-for-composition`). */
const EvalCaseBody = EvalCaseInput.extend({ expected_output: EvalExpectationArray });

/** `/agents/:id/eval-runs/:batchId` — both segments are uuids. */
const BatchParams = z.object({ id: z.string().uuid(), batchId: z.string().uuid() });

/** `since` (ACs 62-63): an ISO-8601 instant, offset allowed; anything else
 *  422s automatically at this boundary (schema-first validation, per
 *  `server/INSIGHTS.md` 2026-07-31 — no hand-rolled date parsing needed). */
const DashboardQuery = z.object({ since: z.string().datetime({ offset: true }).optional() });

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const repo = new EvalsRepository(container.db);
  const runner = new EvalRunner(container, repo);
  runner.registerJobHandler();
  const service = new EvalsService(container, repo, runner);

  // ---- Cases (ACs 2-7) -----------------------------------------------------

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const cases = await service.listCasesForAgent(workspaceId, req.params.id);
    if (!cases) throw new NotFoundError('Agent not found');
    return cases;
  });

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: EvalCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const body = req.body;
      const created = await service.createCase(workspaceId, req.params.id, {
        name: body.name,
        input_diff: body.input_diff,
        input_files: body.input_files,
        input_meta: body.input_meta,
        expected_output: body.expected_output,
        notes: body.notes,
      });
      reply.status(201);
      return created;
    },
  );

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const body = req.body;
      const updated = await service.updateCase(workspaceId, req.params.id, {
        name: body.name,
        input_diff: body.input_diff,
        input_files: body.input_files,
        input_meta: body.input_meta,
        expected_output: body.expected_output,
        notes: body.notes,
      });
      if (!updated) throw new NotFoundError('Eval case not found');
      return updated;
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Eval case not found');
    reply.status(204);
  });

  // ---- Running a single case (AC 32) ---------------------------------------

  app.post(
    '/eval-cases/:id/run',
    { schema: { params: IdParams }, config: { rateLimit: EVAL_RUN_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.runSingleCase(workspaceId, req.params.id);
      if (!result) throw new NotFoundError('Eval case not found');
      return result;
    },
  );

  // ---- Finding → case (ACs 8-18) -------------------------------------------
  // Owned by evals/, not reviews/ — see this file's header doc comment.

  app.post('/findings/:id/eval-case', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const result = await service.createCaseFromFinding(workspaceId, req.params.id);
    if (!result) throw new NotFoundError('Finding not found');
    return result.case;
  });

  // ---- Async batch run (ACs 19-34) -----------------------------------------

  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: EVAL_RUN_RATE_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const accepted = await service.dispatchBatch(workspaceId, req.params.id);
      if (!accepted) throw new NotFoundError('Agent not found');
      reply.status(202);
      return { job_id: accepted.jobId, batch_id: accepted.batchId };
    },
  );

  app.get(
    '/agents/:id/eval-runs/:batchId',
    { schema: { params: BatchParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const status = await service.getBatchStatus(workspaceId, req.params.id, req.params.batchId);
      if (!status) throw new NotFoundError('Agent not found');
      return status;
    },
  );

  // ---- Dashboards (ACs 60-67) -----------------------------------------------

  app.get(
    '/agents/:id/eval-dashboard',
    { schema: { params: IdParams, querystring: DashboardQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const since = req.query.since ? new Date(req.query.since) : undefined;
      const dashboard = await service.getAgentDashboard(workspaceId, req.params.id, since);
      if (!dashboard) throw new NotFoundError('Agent not found');
      return dashboard;
    },
  );

  app.get('/eval-dashboard', { schema: { querystring: DashboardQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const since = req.query.since ? new Date(req.query.since) : undefined;
    return service.getWorkspaceDashboard(workspaceId, since);
  });
}
