/**
 * Conventions module.
 *
 *   GET   /repos/:id/conventions          → ConventionsState (candidates + scan status)
 *   POST  /repos/:id/conventions/extract   → enqueues a CONVENTIONS_EXTRACT_JOB_KIND job (202 + job id)
 *   PATCH /conventions/:id                 → accept/reject and/or inline-edit one candidate
 *
 * Job-handler registration lives here (mirrors `repo-intel/routes.ts`): this
 * plugin runs once at app boot and registers the extraction handler so a job
 * enqueued below has a handler to run against.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { UpdateConventionCandidate, type ConventionsExtractAccepted } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ConventionsService(container);
  service.registerExtractionJobHandler();

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getState(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams } },
    async (req, reply): Promise<ConventionsExtractAccepted> => {
      const { workspaceId } = await getContext(container, req);
      const { jobId, degraded } = await service.triggerExtraction(workspaceId, req.params.id);
      reply.code(202);
      return degraded
        ? { status: 'accepted', degraded: true }
        : { status: 'accepted', job_id: jobId };
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionCandidate } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const candidate = await service.update(workspaceId, req.params.id, req.body);
      if (!candidate) throw new NotFoundError('Convention candidate not found');
      return candidate;
    },
  );
}
