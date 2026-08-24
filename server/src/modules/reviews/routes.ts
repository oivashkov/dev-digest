import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrBlastRadius, PrIntentRecord, PrRiskBrief, RunRequest, SmartDiff } from '@devdigest/shared';
import type { RunEvent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';

/**
 * reviews module.
 *   POST   /pulls/:id/review  {agentId} | {all:true}  → run review(s); returns runs
 *   GET    /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                             → the single-document RunTrace
 *   GET    /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   POST   /findings/:id/(accept|dismiss)              → finding actions
 *   GET    /pulls/:id/intent                           → PR intent (compute-if-missing, cached)
 *   POST   /pulls/:id/intent/refresh                   → PR intent (forced recompute)
 *   GET    /pulls/:id/brief                            → PR why + risk brief (compute-if-missing, cached)
 *   POST   /pulls/:id/brief/refresh                    → PR why + risk brief (forced recompute)
 *   GET    /pulls/:id/smart-diff                       → files grouped by review risk (deterministic, no LLM)
 *   GET    /pulls/:id/blast                            → blast radius: symbols/callers/endpoints/crons (deterministic, no LLM)
 */
const FINDING_ACTIONS = ['accept', 'dismiss'] as const;
export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  // Body is validated at the route boundary like every other mutating route
  // (schema-first, per INSIGHTS.md's 2026-07-31 decision); `.optional()` on
  // top of RunRequest keeps the original tolerance — both fields are already
  // optional, and a genuinely bodyless request (no Content-Type/body at all)
  // is still accepted rather than rejected before the handler runs.
  app.post(
    '/pulls/:id/review',
    {
      schema: { params: IdParams, body: RunRequest.optional() },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = req.body ?? {};
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    const { runs, reviews } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
    );
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
    await getContext(container, req);
    const runId = req.params.id;

    reply.sse(
      (async function* () {
        // Bridge the in-memory RunBus to an async iterator the SSE plugin drains.
        const queue: RunEvent[] = [];
        let resolve: (() => void) | null = null;
        let done = false;

        const unsubscribe = container.runBus.subscribe(runId, (e) => {
          queue.push(e);
          resolve?.();
        });
        const offDone = container.runBus.onDone(runId, () => {
          done = true;
          resolve?.();
        });

        try {
          while (true) {
            if (queue.length === 0) {
              if (done) break;
              await new Promise<void>((r) => (resolve = r));
              resolve = null;
              continue;
            }
            const e = queue.shift()!;
            yield {
              id: String(e.seq),
              event: e.kind,
              data: JSON.stringify(e),
            };
          }
        } finally {
          unsubscribe();
          offDone();
        }
      })(),
    );
  });

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get('/pulls/:id/runs/active', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.activeRuns(workspaceId, req.params.id);
  });

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete('/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post('/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    await service.cancelRun(req.params.id);
    return { ok: true };
  });

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get('/runs/:id/trace', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get('/pulls/:id/reviews', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });

  // ---- SmartDiff: files grouped by review risk (deterministic, no LLM) ----
  // Recomputed fresh on every call — no caching table, no rate limit (unlike
  // the LLM-triggering intent/review routes above).
  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams, response: { 200: SmartDiff } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getSmartDiff(workspaceId, req.params.id);
    },
  );

  // ---- Blast radius: symbols/callers/endpoints/crons (deterministic, no LLM) -
  // Same as SmartDiff above: recomputed fresh on every call, no caching table,
  // no rate limit — no LLM call happens on this route.
  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: PrBlastRadius } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getBlastRadius(workspaceId, req.params.id);
    },
  );

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Review not found');
    return { ok: true };
  });

  // ---- PR intent: lazy compute-if-missing, cached ---------------------------
  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams, response: { 200: PrIntentRecord } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getOrComputeIntent(workspaceId, req.params.id, { force: false }, req.log);
    },
  );

  // ---- PR intent: forced refresh -------------------------------------------
  // Same rate limit as POST /pulls/:id/review — this is a real LLM-triggering
  // endpoint too, just for the intent classifier instead of the review agent.
  app.post(
    '/pulls/:id/intent/refresh',
    {
      schema: { params: IdParams, response: { 200: PrIntentRecord } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getOrComputeIntent(workspaceId, req.params.id, { force: true }, req.log);
    },
  );

  // ---- PR why + risk brief: lazy compute-if-missing, cached ----------------
  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: PrRiskBrief } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getOrComputeRiskBrief(workspaceId, req.params.id, { force: false }, req.log);
    },
  );

  // ---- PR why + risk brief: forced refresh ----------------------------------
  // Same rate limit as POST /pulls/:id/intent/refresh — this is a real
  // LLM-triggering endpoint too, just for the risk-brief extraction call.
  app.post(
    '/pulls/:id/brief/refresh',
    {
      schema: { params: IdParams, response: { 200: PrRiskBrief } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getOrComputeRiskBrief(workspaceId, req.params.id, { force: true }, req.log);
    },
  );

  // ---- Finding actions (accept / dismiss) ---------------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(`/findings/:id/${action}`, { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.actOnFinding(workspaceId, req.params.id, action);
      return result;
    });
  }
}
