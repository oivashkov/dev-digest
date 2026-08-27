/**
 * evals module — running (ACs 19-34). The runner calls `reviewPullRequest`
 * directly (not `ReviewRunExecutor`), so — unlike `reviews.it.test.ts` —
 * there is no Intent Layer pre-work to mock: only `llm.openai` needs a mock
 * for these tests (agent.provider = 'openai').
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
  console.warn('[evals-runs] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Hunk covers new-side lines 10-13; line 11 is the added line. Mirrors
 *  `reviews.it.test.ts`'s DIFF fixture so grounding behavior is familiar. */
const GOOD_DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** One kept finding (line 11, inside the hunk) + one grounding-dropped
 *  hallucination (line 999, not in the diff) — same shape as
 *  `reviews.it.test.ts`'s REVIEW_FIXTURE, so citation_accuracy = 1/2 = 0.5
 *  and the case's own `must_find` expectation (line 11) is satisfied. */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live key is committed in source.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

let agentSeq = 0;
async function insertAgent(db: PgFixture['handle']['db'], workspaceId: string) {
  const [agent] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name: `Eval Runner Agent ${agentSeq++}`,
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Review the diff.',
    })
    .returning();
  return agent!;
}

d('evals module — running (Testcontainers pg)', () => {
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
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    return { app: buildApp({ config: config(), db: pg.handle.db, overrides: { llm: { openai: llm } } }), llm };
  }

  it('400s without enqueuing when the agent has zero eval cases — no LLM call is made', async () => {
    const { app: appPromise, llm } = app();
    const a = await appPromise;
    const agent = await insertAgent(pg.handle.db, workspaceId);

    const res = await a.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(400);
    expect(llm.calls).toHaveLength(0);

    await a.close();
  });

  it('runs a single case synchronously (200 EvalRunResult)', async () => {
    const { app: appPromise } = app();
    const a = await appPromise;
    const agent = await insertAgent(pg.handle.db, workspaceId);

    const created = await a.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'sync-case',
        input_diff: GOOD_DIFF,
        expected_output: [{ expect: 'must_find', file: 'src/config.ts', start_line: 11, end_line: 11 }],
      },
    });
    expect(created.statusCode).toBe(201);
    const caseId = created.json().id as string;

    const run = await a.inject({ method: 'POST', url: `/eval-cases/${caseId}/run` });
    expect(run.statusCode).toBe(200);
    const body = run.json();
    expect(body.case_id).toBe(caseId);
    expect(body.result.traces_total).toBe(1);
    expect(body.result.traces_passed).toBe(1);
    expect(body.result.per_trace[0]).toMatchObject({ name: 'sync-case', pass: true });

    await a.close();
  });

  it('dispatches a batch (202), reports a transitional status immediately, then an aggregate after the queue drains — one malformed case does not abort the batch', async () => {
    const { app: appPromise } = app();
    const a = await appPromise;
    const agent = await insertAgent(pg.handle.db, workspaceId);

    const good = await a.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'batch-good-case',
        input_diff: GOOD_DIFF,
        expected_output: [{ expect: 'must_find', file: 'src/config.ts', start_line: 11, end_line: 11 }],
      },
    });
    expect(good.statusCode).toBe(201);

    // A row written directly to the DB (bypassing the route's zod
    // validation) with a malformed `expected_output` — simulates a legacy
    // row and is what makes `EvalExpectationArray.parse` throw INSIDE
    // `runOneCase` (AC 34's per-case failure path; `parseUnifiedDiff`
    // itself never throws — it degrades to zero files on bad input — so a
    // malformed diff can't be used to trigger this path).
    await pg.handle.db.insert(t.evalCases).values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agent.id,
      name: 'batch-broken-case',
      inputDiff: GOOD_DIFF,
      expectedOutput: { not: 'an array' } as unknown as object,
    });

    const dispatch = await a.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(dispatch.statusCode).toBe(202);
    const { job_id: jobId, batch_id: batchId } = dispatch.json();
    expect(jobId).toBeTruthy();
    expect(batchId).toBeTruthy();

    // No artificial delay — enqueue() only awaits the DB insert before
    // returning (server/INSIGHTS.md, 2026-08-23), so a GET fired right after
    // reliably observes the transitional state.
    const transitional = await a.inject({
      method: 'GET',
      url: `/agents/${agent.id}/eval-runs/${batchId}`,
    });
    expect(transitional.statusCode).toBe(200);
    expect(['queued', 'running']).toContain(transitional.json().status);
    expect(transitional.json().result).toBeNull();

    await a.container.jobs.onIdle();

    const done = await a.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs/${batchId}` });
    expect(done.statusCode).toBe(200);
    const doneBody = done.json();
    expect(doneBody.status).toBe('done');
    expect(doneBody.result.traces_total).toBe(2);
    expect(doneBody.result.traces_passed).toBe(1); // only the good case passes
    const byName = Object.fromEntries(
      doneBody.result.per_trace.map((tr: { name: string; pass: boolean }) => [tr.name, tr.pass]),
    );
    expect(byName['batch-good-case']).toBe(true);
    expect(byName['batch-broken-case']).toBe(false);

    await a.close();
  });
});
