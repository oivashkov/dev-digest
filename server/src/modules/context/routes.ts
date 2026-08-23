import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SpecPath } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ContextService } from './service.js';
import { CONTEXT_REINDEX_RATE_LIMIT } from './constants.js';

/**
 * Project Context module (SPEC-01) — browse/preview/refresh only, no write
 * path into the clone (Q9).
 *
 *   GET  /repos/:id/context             → ContextDiscovery (documents + degraded + tokens_total)
 *   GET  /repos/:id/context/file        → one document's current text (?path=…)
 *   POST /repos/:id/context/reindex     → re-walk + refresh (same shape as GET; Q5)
 *
 * Attaching a document to an agent/skill is `/agents/:id/context` /
 * `/skills/:id/context` — owned by those modules (Step 4), same split as
 * `/agents/:id/skills` living in `agents/routes.ts` rather than here.
 */

const ContextFileQuery = z.object({ path: SpecPath });

export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ContextService(app.container);

  app.get('/repos/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const discovery = await service.discover(workspaceId, req.params.id);
    if (!discovery) throw new NotFoundError('Repo not found');
    return discovery;
  });

  app.get(
    '/repos/:id/context/file',
    { schema: { params: IdParams, querystring: ContextFileQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const doc = await service.getDocument(workspaceId, req.params.id, req.query.path);
      if (!doc) throw new NotFoundError('Document not found');
      return doc;
    },
  );

  app.post(
    '/repos/:id/context/reindex',
    { schema: { params: IdParams }, config: { rateLimit: CONTEXT_REINDEX_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const discovery = await service.discover(workspaceId, req.params.id);
      if (!discovery) throw new NotFoundError('Repo not found');
      return discovery;
    },
  );
}
