/**
 * evals module — case CRUD (ACs 2-7) and the finding→case path (ACs 8-18).
 * Real Postgres because both paths are workspace-scoped multi-table reads
 * (case → agent, finding → review → pull → pr_files).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-cases] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const validExpectedOutput = [{ expect: 'must_find', file: 'src/x.ts', start_line: 1, end_line: 2 }];

let repoSeq = 0;

async function insertAgent(db: PgFixture['handle']['db'], workspaceId: string) {
  const [agent] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name: `Eval Agent ${repoSeq++}`,
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Review the diff.',
    })
    .returning();
  return agent!;
}

/** A repo + PR + review + finding chain, with a `pr_files` row carrying a
 *  real patch for the finding's file (so AC 11's diff-reconstruction has
 *  something to read). `patchless` skips that row (AC 18). */
async function insertFindingChain(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  agentId: string,
  opts: {
    acceptedAt?: Date | null;
    dismissedAt?: Date | null;
    patchless?: boolean;
    /** Distinct per scenario so `deriveEvalCaseName` (title slug +
     *  `file:start_line`) doesn't collide across findings created within
     *  the same test — a collision would make the SECOND call idempotently
     *  return the FIRST case (AC 14), which is correct product behavior but
     *  would make this test assert against the wrong finding's case. */
    title?: string;
  } = {},
) {
  const name = `eval-findings-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 501,
      title: 'Tighten input validation',
      author: 'sara.lin',
      branch: 'fix/validation',
      base: 'main',
      headSha: 'cafebabe',
      body: 'Adds a length check.',
      status: 'open',
    })
    .returning();
  if (!opts.patchless) {
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/x.ts',
      patch: '@@ -1,2 +1,3 @@\n context\n+added line\n context',
    });
  }
  const [review] = await db
    .insert(t.reviews)
    .values({ workspaceId, prId: pr!.id, agentId, kind: 'review', score: 80 })
    .returning();
  const [finding] = await db
    .insert(t.findings)
    .values({
      reviewId: review!.id,
      file: 'src/x.ts',
      startLine: 1,
      endLine: 2,
      severity: 'WARNING',
      category: 'bug',
      title: opts.title ?? 'Missing length check',
      rationale: 'Because.',
      confidence: 0.8,
      acceptedAt: opts.acceptedAt ?? null,
      dismissedAt: opts.dismissedAt ?? null,
    })
    .returning();
  return { repo: repo!, pr: pr!, review: review!, finding: finding! };
}

d('evals module — case CRUD + finding→case (Testcontainers pg)', () => {
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

  it('creates, lists, updates, and deletes a case; rejects a duplicate name (409) and malformed expected_output (422)', async () => {
    const a = await app();
    const agent = await insertAgent(pg.handle.db, workspaceId);

    const create = await a.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'basic-case',
        input_diff: 'diff --git a/src/x.ts b/src/x.ts\n@@ -1 +1 @@\n-a\n+b',
        expected_output: validExpectedOutput,
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();
    expect(created).toMatchObject({ owner_kind: 'agent', owner_id: agent.id, name: 'basic-case' });

    const list = await a.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const update = await a.inject({
      method: 'PUT',
      url: `/eval-cases/${created.id}`,
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'basic-case-renamed',
        input_diff: created.input_diff,
        expected_output: validExpectedOutput,
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().name).toBe('basic-case-renamed');

    const duplicate = await a.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'basic-case-renamed',
        input_diff: 'x',
        expected_output: [],
      },
    });
    expect(duplicate.statusCode).toBe(409);

    const malformed = await a.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'malformed-case',
        input_diff: 'x',
        expected_output: [{ file: 'src/x.ts' }], // missing required start_line
      },
    });
    expect(malformed.statusCode).toBe(422);

    const del = await a.inject({ method: 'DELETE', url: `/eval-cases/${created.id}` });
    expect(del.statusCode).toBe(204);
    const afterDelete = await a.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(afterDelete.json()).toHaveLength(0);

    await a.close();
  });

  it('404s for a case belonging to another workspace', async () => {
    const a = await app();
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-eval-ws' }).returning();
    const foreignAgent = await insertAgent(db, otherWs!.id);
    const [foreignCase] = await db
      .insert(t.evalCases)
      .values({
        workspaceId: otherWs!.id,
        ownerKind: 'agent',
        ownerId: foreignAgent.id,
        name: 'foreign-case',
        inputDiff: 'x',
        expectedOutput: [],
      })
      .returning();

    const get = await a.inject({ method: 'GET', url: `/agents/${foreignAgent.id}/eval-cases` });
    expect(get.statusCode).toBe(404);

    const put = await a.inject({
      method: 'PUT',
      url: `/eval-cases/${foreignCase!.id}`,
      payload: {
        owner_kind: 'agent',
        owner_id: foreignAgent.id,
        name: 'renamed',
        input_diff: 'x',
        expected_output: [],
      },
    });
    expect(put.statusCode).toBe(404);

    const del = await a.inject({ method: 'DELETE', url: `/eval-cases/${foreignCase!.id}` });
    expect(del.statusCode).toBe(404);

    await a.close();
  });

  it('finding→case: accepted becomes must_find, dismissed becomes must_not_flag, a repeat click is idempotent (200, same id), an un-actioned finding 400s, and a missing patch 400s', async () => {
    const a = await app();
    const agent = await insertAgent(pg.handle.db, workspaceId);

    const accepted = await insertFindingChain(pg.handle.db, workspaceId, agent.id, {
      acceptedAt: new Date(),
      title: 'Accepted finding case',
    });
    const first = await a.inject({
      method: 'POST',
      url: `/findings/${accepted.finding.id}/eval-case`,
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.owner_id).toBe(agent.id);
    expect(firstBody.expected_output).toEqual([
      expect.objectContaining({ expect: 'must_find', file: 'src/x.ts', start_line: 1, end_line: 2 }),
    ]);

    // Repeat click on the SAME finding is idempotent — same case id, no dup.
    const repeat = await a.inject({
      method: 'POST',
      url: `/findings/${accepted.finding.id}/eval-case`,
    });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().id).toBe(firstBody.id);
    const casesAfterRepeat = await a.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(casesAfterRepeat.json()).toHaveLength(1);

    const dismissed = await insertFindingChain(pg.handle.db, workspaceId, agent.id, {
      dismissedAt: new Date(),
      title: 'Dismissed finding case',
    });
    const dismissedRes = await a.inject({
      method: 'POST',
      url: `/findings/${dismissed.finding.id}/eval-case`,
    });
    expect(dismissedRes.statusCode).toBe(200);
    expect(dismissedRes.json().expected_output).toEqual([
      expect.objectContaining({ expect: 'must_not_flag', file: 'src/x.ts' }),
    ]);

    const unactioned = await insertFindingChain(pg.handle.db, workspaceId, agent.id, {
      title: 'Unactioned finding case',
    });
    const unactionedRes = await a.inject({
      method: 'POST',
      url: `/findings/${unactioned.finding.id}/eval-case`,
    });
    expect(unactionedRes.statusCode).toBe(400);

    const missingPatch = await insertFindingChain(pg.handle.db, workspaceId, agent.id, {
      acceptedAt: new Date(),
      patchless: true,
      title: 'Missing patch finding case',
    });
    const missingPatchRes = await a.inject({
      method: 'POST',
      url: `/findings/${missingPatch.finding.id}/eval-case`,
    });
    expect(missingPatchRes.statusCode).toBe(400);

    await a.close();
  });
});
