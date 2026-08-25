/**
 * Project Context (SPEC-01) — route-level integration tests
 * (`GET /repos/:id/context`, `GET /repos/:id/context/file`,
 * `POST /repos/:id/context/reindex`). No LLM call is on this path (the
 * module never resolves a provider), so no `llm` override is needed —
 * unlike `test/reviews-intent-routes.it.test.ts`'s workaround for
 * `review_intent`'s registry default (`server/INSIGHTS.md`, 2026-08-18).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (dir && dir !== root) await mkdir(dir, { recursive: true });
  await writeFile(full, contents);
}

let repoSeq = 0;
async function insertRepo(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  clonePath: string | null,
) {
  const name = `context-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
    .returning();
  return repo!;
}

d('Project Context routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    clonePath = await mkdtemp(join(tmpdir(), 'context-routes-'));
    await writeFileAt(clonePath, 'specs/01-feature.md', '# Feature spec\n\nBody text.');
    await writeFileAt(clonePath, 'docs/architecture.md', '# Architecture');
    await writeFileAt(clonePath, 'INSIGHTS.md', '# Insights');
    await writeFileAt(clonePath, 'notes.txt', 'not markdown, not discovered');
    await writeFileAt(clonePath, 'src/index.ts', 'export {}');
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(clonePath, { recursive: true, force: true });
  });

  function app() {
    return buildApp({ config: config(), db: pg.handle.db, overrides: { embedder: new MockEmbedder() } });
  }

  it('lists discovered documents against a fixture clone', async () => {
    const repo = await insertRepo(pg.handle.db, workspaceId, clonePath);
    const a = await app();

    const res = await a.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.degraded).toBe(false);
    const paths = body.documents.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(['INSIGHTS.md', 'docs/architecture.md', 'specs/01-feature.md']);
    const spec = body.documents.find((d: { path: string }) => d.path === 'specs/01-feature.md');
    expect(spec.type).toBe('specs');
    expect(spec.tokens).toBeGreaterThan(0);
    expect(body.tokens_total).toBeGreaterThan(0);
    expect(body.last_scan_at).toBeTruthy();

    await a.close();
  });

  it('reads a single document for preview', async () => {
    const repo = await insertRepo(pg.handle.db, workspaceId, clonePath);
    const a = await app();

    const res = await a.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/file?path=${encodeURIComponent('specs/01-feature.md')}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toContain('Body text.');

    await a.close();
  });

  it('rejects a traversal path on the preview route with a 422 before the handler runs', async () => {
    const repo = await insertRepo(pg.handle.db, workspaceId, clonePath);
    const a = await app();

    const res = await a.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/file?path=${encodeURIComponent('../etc/passwd')}`,
    });
    expect(res.statusCode).toBe(422);

    await a.close();
  });

  it('degrades to an empty list when the repo has no local clone', async () => {
    const repo = await insertRepo(pg.handle.db, workspaceId, null);
    const a = await app();

    const res = await a.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.degraded).toBe(true);
    expect(body.documents).toEqual([]);

    await a.close();
  });

  it('reindex re-walks and returns the same envelope shape as GET', async () => {
    const repo = await insertRepo(pg.handle.db, workspaceId, clonePath);
    const a = await app();

    const res = await a.inject({ method: 'POST', url: `/repos/${repo.id}/context/reindex` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.degraded).toBe(false);
    expect(body.documents.length).toBe(3);

    await a.close();
  });
});
