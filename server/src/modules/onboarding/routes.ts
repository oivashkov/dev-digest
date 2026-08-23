/**
 * Onboarding module (SPEC-02).
 *
 *   GET  /repos/:id/onboarding            → OnboardingState (cached tour + status)
 *   POST /repos/:id/onboarding/generate   → enqueues an ONBOARDING_GENERATE_JOB_KIND job (202 + job id)
 *
 * Job-handler registration lives here (mirrors `conventions/routes.ts`): this
 * plugin runs once at app boot and registers the generation handler so a job
 * enqueued below has a handler to run against.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { OnboardingGenerateAccepted } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { OnboardingService } from './service.js';

export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new OnboardingService(container);
  service.registerGenerationJobHandler();

  app.get('/repos/:id/onboarding', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const state = await service.getState(workspaceId, req.params.id);
    if (!state) throw new NotFoundError('Repo not found');
    return state;
  });

  app.post(
    '/repos/:id/onboarding/generate',
    { schema: { params: IdParams } },
    async (req, reply): Promise<OnboardingGenerateAccepted> => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.triggerGeneration(workspaceId, req.params.id);
      if (!result) throw new NotFoundError('Repo not found');
      reply.code(202);
      return result.degraded
        ? { status: 'accepted', degraded: true }
        : { status: 'accepted', job_id: result.jobId };
    },
  );
}
