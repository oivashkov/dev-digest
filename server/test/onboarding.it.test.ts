/**
 * Onboarding module (SPEC-02) — route-level integration tests.
 *
 * `onboarding`'s FEATURE_MODELS default is `openrouter/deepseek-v4-flash`
 * (`contracts/platform.ts`), so per `server/INSIGHTS.md` (2026-08-18) this
 * MUST register a MockLLMProvider('openrouter', ...) — overriding only
 * `openai`/`anthropic` is not actually hermetic on a machine with a real
 * `OPENROUTER_API_KEY` configured.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider, MockEmbedder } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[onboarding] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const FIXTURE_TOUR = {
  sections: [
    { kind: 'architecture', title: 'Architecture', body: 'The system...', diagram: null, links: [] },
    {
      kind: 'critical_paths',
      title: 'Critical paths',
      body: 'These files matter most...',
      links: [],
    },
    {
      kind: 'local_setup',
      title: 'How to run locally',
      body: 'Run `pnpm install` then `pnpm dev`.',
      links: [{ label: 'package.json', path: 'package.json' }],
    },
    { kind: 'reading_path', title: 'Guided reading path', body: 'Start here...', links: [] },
    { kind: 'first_tasks', title: 'First tasks', body: 'Try fixing a typo...', links: [] },
  ],
};

let repoSeq = 0;
async function insertRepo(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  clonePath: string | null,
) {
  const name = `onboarding-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
    .returning();
  return repo!;
}

d('Onboarding module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonePath: string;
  let llm: MockLLMProvider;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    clonePath = await mkdtemp(join(tmpdir(), 'onboarding-routes-'));
    await mkdir(clonePath, { recursive: true });
    await writeFile(join(clonePath, 'package.json'), JSON.stringify({ scripts: { dev: 'x' } }));
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(clonePath, { recursive: true, force: true });
  });

  function app() {
    llm = new MockLLMProvider('openrouter', { structuredBySchema: { OnboardingTour: FIXTURE_TOUR } });
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), llm: { openrouter: llm } },
    });
  }

  it('GET on a repo with no cached row returns the empty state', async () => {
    const [demo] = await pg.handle.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    const a = await app();

    const res = await a.inject({ method: 'GET', url: `/repos/${demo!.id}/onboarding` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tour: null, status: 'empty', generated_at: null });

    await a.close();
  });

  it('POST generate returns 202, GET reports generating, a concurrent POST does not enqueue a second job, and the completed job persists a ready tour', async () => {
    const repo = await insertRepo(pg.handle.db, workspaceId, clonePath);
    const a = await app();

    const first = await a.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ status: 'accepted' });

    const generating = await a.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(generating.json()).toMatchObject({ status: 'generating' });

    const second = await a.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual({ status: 'accepted', job_id: null });

    await a.container.jobs.onIdle();

    const ready = await a.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(ready.statusCode).toBe(200);
    const body = ready.json();
    expect(body.status).toBe('ready');
    expect(body.tour.sections).toHaveLength(5);
    expect(body.generated_at).toBeTruthy();

    // No further LLM call was made just by re-reading the cached tour.
    const callsAfterRead = llm.calls.filter((c) => c.method === 'completeStructured').length;
    expect(callsAfterRead).toBe(1);

    await a.close();
  });
});
