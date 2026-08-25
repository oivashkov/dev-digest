/**
 * Project Context module constants (SPEC-01).
 */

/** Reindex is rate-limited like other on-demand re-scan endpoints (e.g.
 *  conventions extraction, PR intent refresh) — a no-op under
 *  `NODE_ENV==='test'` since `@fastify/rate-limit` isn't registered there
 *  (`server/INSIGHTS.md`, 2026-08-18). */
export const CONTEXT_REINDEX_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
