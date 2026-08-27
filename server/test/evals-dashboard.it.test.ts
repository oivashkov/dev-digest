/**
 * evals module — dashboard aggregation (ACs 60-67). Two real batch runs of
 * the SAME case, at two different `agents.version`s, so `delta`/`trend`/
 * `alert` have real before/after data to compute over (AC 53, 64, 66).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-dashboard] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,4 +10,5 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
+  other: 1,
   redisUrl: x,`;

/** One finding exactly at the case's expected line — recall=1, precision=1. */
const PASSING_REVIEW: Review = {
  verdict: 'request_changes',
  summary: 'ok',
  score: 80,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'x',
      confidence: 0.9,
      kind: 'finding',
    },
  ],
};

/** A finding on a DIFFERENT (but still in-diff) line — matches nothing the
 *  case expects, so recall=0, precision=0, pass=false. */
const FAILING_REVIEW: Review = {
  verdict: 'comment',
  summary: 'ok',
  score: 60,
  findings: [
    {
      id: 'f2',
      severity: 'WARNING',
      category: 'bug',
      title: 'Unrelated finding',
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
      rationale: 'x',
      confidence: 0.6,
      kind: 'finding',
    },
  ],
};

let agentSeq = 0;
async function insertAgent(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { enabled?: boolean } = {},
) {
  const [agent] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name: `Eval Dashboard Agent ${agentSeq++}`,
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Review the diff.',
      enabled: opts.enabled ?? true,
    })
    .returning();
  return agent!;
}

async function runBatch(pg: PgFixture, workspaceId: string, agentId: string, review: Review) {
  const llm = new MockLLMProvider('openai', { structured: review });
  const a = await buildApp({
    config: config(),
    db: pg.handle.db,
    overrides: { llm: { openai: llm } },
  });
  const dispatch = await a.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
  expect(dispatch.statusCode).toBe(202);
  await a.container.jobs.onIdle();
  await a.close();
}

d('evals module — dashboard (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function app() {
    return buildApp({ config: config(), db: pg.handle.db });
  }

  it('computes delta/alert across two runs of the same case set, filters by since, and rejects a malformed since with 422', async () => {
    const a = await app();
    const agent = await insertAgent(pg.handle.db, workspaceId);

    const created = await a.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'dashboard-case',
        input_diff: DIFF,
        expected_output: [{ expect: 'must_find', file: 'src/config.ts', start_line: 11, end_line: 11 }],
      },
    });
    expect(created.statusCode).toBe(201);

    // Run 1: passes (recall=1, precision=1).
    await runBatch(pg, workspaceId, agent.id, PASSING_REVIEW);

    const between = new Date();

    // Config edit bumps agents.version between the two runs (AC 30, 53).
    await a.inject({
      method: 'PUT',
      url: `/agents/${agent.id}`,
      payload: { system_prompt: 'Review the diff, v2.' },
    });

    // Run 2: fails (recall=0, precision=0) — a real precision drop.
    await runBatch(pg, workspaceId, agent.id, FAILING_REVIEW);

    const dashboard = await a.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` });
    expect(dashboard.statusCode).toBe(200);
    const body = dashboard.json();
    expect(body.owner_id).toBe(agent.id);
    expect(body.cases_total).toBe(1);
    expect(body.trend).toHaveLength(2);
    expect(body.current.traces_passed).toBe(0);
    expect(body.current.traces_total).toBe(1);
    expect(body.delta.precision).toBeCloseTo(-1, 5);
    expect(body.alert).toBeTruthy();
    expect(body.alert).toMatch(/precision/i);
    expect(body.alert).toMatch(/v2\b|v\d/); // names A version, exact wording not spec-mandated

    // `since` scoped to only the second run.
    const filtered = await a.inject({
      method: 'GET',
      url: `/agents/${agent.id}/eval-dashboard?since=${encodeURIComponent(between.toISOString())}`,
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().trend).toHaveLength(1);
    // Exactly one recorded run in the filtered window ⇒ delta is all zero (AC 65).
    expect(filtered.json().delta).toEqual({ recall: 0, precision: 0, citation_accuracy: 0 });

    const badSince = await a.inject({
      method: 'GET',
      url: `/agents/${agent.id}/eval-dashboard?since=not-a-date`,
    });
    expect(badSince.statusCode).toBe(422);

    await a.close();
  });

  it('the workspace dashboard lists only ENABLED agents, and skips one with zero runs to the empty-state shape', async () => {
    const a = await app();
    const noRunsAgent = await insertAgent(pg.handle.db, workspaceId);
    const disabledAgent = await insertAgent(pg.handle.db, workspaceId, { enabled: false });

    const all = await a.inject({ method: 'GET', url: '/eval-dashboard' });
    expect(all.statusCode).toBe(200);
    const ownerIds = (all.json() as { owner_id: string }[]).map((d) => d.owner_id);
    expect(ownerIds).toContain(noRunsAgent.id);
    expect(ownerIds).not.toContain(disabledAgent.id);

    const noRunsEntry = (all.json() as { owner_id: string; current: { traces_total: number } }[]).find(
      (e) => e.owner_id === noRunsAgent.id,
    );
    expect(noRunsEntry?.current.traces_total).toBe(0);

    await a.close();
  });
});
