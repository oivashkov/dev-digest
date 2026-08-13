import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { SkillsService } from '../src/modules/skills/service.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';
import type { Container } from '../src/platform/container.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * Skills CRUD + versioning + import preview. Covers: create/list/get/update
 * /delete, workspace scoping, 404s, "content change bumps version, enabled
 * toggle doesn't" (mirrors agents), and that import/preview never persists.
 */
d('Skills module', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const createBody = {
    name: 'No-Mock Rule',
    description: 'Do not mock the repository layer in unit tests.',
    type: 'convention' as const,
    body: 'Prefer the real repository against testcontainers over a mock.',
  };

  it('creates a skill (source defaults to manual, enabled defaults to true)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/skills', payload: createBody });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: createBody.name,
      type: 'convention',
      source: 'manual',
      enabled: true,
      version: 1,
    });
    await app.close();
  });

  it('a non-manual source defaults to disabled — vet before it reaches a prompt', async () => {
    const app = await makeApp();
    const extracted = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { ...createBody, name: 'Extracted skill', source: 'extracted' },
    });
    expect(extracted.json()).toMatchObject({ source: 'extracted', enabled: false });

    // An explicit `enabled: true` still wins — this is a default, not a lock.
    const vetted = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { ...createBody, name: 'Pre-vetted extracted skill', source: 'extracted', enabled: true },
    });
    expect(vetted.json()).toMatchObject({ source: 'extracted', enabled: true });

    // A manual skill is unaffected — still defaults to enabled.
    const manual = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { ...createBody, name: 'Manual skill' },
    });
    expect(manual.json()).toMatchObject({ source: 'manual', enabled: true });
    await app.close();
  });

  it('lists and fetches by id', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();

    const list = await app.inject({ method: 'GET', url: '/skills' });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((s: { id: string }) => s.id === created.id)).toBe(true);

    const one = await app.inject({ method: 'GET', url: `/skills/${created.id}` });
    expect(one.statusCode).toBe(200);
    expect(one.json().id).toBe(created.id);
    await app.close();
  });

  it('a body/name/type/description edit bumps the version', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();

    const updated = await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { body: 'Updated body text.' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);
    await app.close();
  });

  it('toggling enabled does NOT bump the version', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();

    const toggled = await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { enabled: false },
    });
    expect(toggled.statusCode).toBe(200);
    expect(toggled.json()).toMatchObject({ enabled: false, version: 1 });
    await app.close();
  });

  it('deletes a skill', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();

    const del = await app.inject({ method: 'DELETE', url: `/skills/${created.id}` });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/skills/${created.id}` })).statusCode).toBe(
      404,
    );
    await app.close();
  });

  it('404s for an unknown skill on get/update/delete', async () => {
    const app = await makeApp();
    const ghost = '00000000-0000-0000-0000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/skills/${ghost}` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'PUT', url: `/skills/${ghost}`, payload: { body: 'x' } }))
        .statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/skills/${ghost}` })).statusCode).toBe(
      404,
    );
    await app.close();
  });

  it('skills are workspace-scoped: another tenant cannot read/update/delete them', async () => {
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-skills' }).returning();
    const repo = new SkillsRepository(db);
    const foreign = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign skill',
      type: 'custom',
      body: 'x',
    });

    const service = new SkillsService({ db } as unknown as Container);
    const [{ id: defaultWs }] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));

    expect(await service.get(otherWs!.id, foreign.id)).toBeDefined();
    expect(await service.get(defaultWs!, foreign.id)).toBeUndefined();
    expect(await service.update(defaultWs!, foreign.id, { body: 'y' })).toBeUndefined();
    expect(await service.delete(defaultWs!, foreign.id)).toBe(false);
  });

  it('import/preview parses a markdown upload without persisting anything', async () => {
    const app = await makeApp();
    const before = (await app.inject({ method: 'GET', url: '/skills' })).json().length;

    const md = '# Imported Convention\n\nAlways use snake_case for column names.';
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: {
        filename: 'imported-convention.md',
        content_base64: Buffer.from(md, 'utf8').toString('base64'),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      name: 'Imported Convention',
      source: 'extracted',
    });

    const after = (await app.inject({ method: 'GET', url: '/skills' })).json().length;
    expect(after).toBe(before);
    await app.close();
  });

  it('import/preview of a zip only reads text entries, never an executable one', async () => {
    const app = await makeApp();
    const zip = zipSync({
      'SKILL.md': strToU8('# Zipped Skill\n\nBody from the archive.'),
      'setup.sh': strToU8('#!/bin/sh\nrm -rf /'),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: {
        filename: 'bundle.zip',
        content_base64: Buffer.from(zip).toString('base64'),
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('Zipped Skill');
    expect(body.evidence_files).toEqual(['SKILL.md']);
    await app.close();
  });
});

/**
 * Versions (body-snapshot history) + restore.
 */
d('Skill versions & restore', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  it('v1 is snapshotted on create, labeled "Initial version"', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `Versioned ${Date.now()}`, type: 'custom', body: 'first body' },
      })
    ).json();

    const res = await app.inject({ method: 'GET', url: `/skills/${created.id}/versions` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({ version: 1, body: 'first body', summary: 'Initial version' }),
    ]);
    await app.close();
  });

  it('each content-changing update snapshots a new version, newest first, auto-summarized', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `Versioned ${Date.now()}`, type: 'custom', body: 'v1 body' },
      })
    ).json();

    await app.inject({ method: 'PUT', url: `/skills/${created.id}`, payload: { body: 'v2 body' } });
    await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { name: 'Renamed', type: 'security' },
    });
    // Toggling `enabled` alone must NOT add a version row.
    await app.inject({ method: 'PUT', url: `/skills/${created.id}`, payload: { enabled: false } });

    const versions = (await app.inject({ method: 'GET', url: `/skills/${created.id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0]).toMatchObject({ summary: 'Updated name, type' });
    expect(versions[1]).toMatchObject({ summary: 'Updated body', body: 'v2 body' });
    expect(versions[2]).toMatchObject({ summary: 'Initial version', body: 'v1 body' });
    await app.close();
  });

  it('restoring an old version brings back its body and adds a new "Restored to vN" snapshot', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `Versioned ${Date.now()}`, type: 'custom', body: 'v1 body' },
      })
    ).json();
    await app.inject({ method: 'PUT', url: `/skills/${created.id}`, payload: { body: 'v2 body' } });

    const restored = await app.inject({
      method: 'POST',
      url: `/skills/${created.id}/versions/1/restore`,
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ body: 'v1 body', version: 3 });

    const versions = (await app.inject({ method: 'GET', url: `/skills/${created.id}/versions` })).json();
    expect(versions[0]).toMatchObject({ version: 3, body: 'v1 body', summary: 'Restored to v1' });
    await app.close();
  });

  it('404s restoring an unknown skill or an unrecorded version', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `Versioned ${Date.now()}`, type: 'custom', body: 'v1 body' },
      })
    ).json();

    const ghostSkill = '00000000-0000-0000-0000-000000000000';
    expect(
      (await app.inject({ method: 'POST', url: `/skills/${ghostSkill}/versions/1/restore` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: `/skills/${created.id}/versions/99/restore` })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/skills/${ghostSkill}/versions` })).statusCode).toBe(
      404,
    );
    await app.close();
  });
});

/**
 * Stats — derived from real agent_skills/reviews/findings rows, using the
 * skill-type → finding-category approximation documented on `SkillStats`.
 */
d('Skill stats', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  it('an unattached skill has zero usage — no agents, nulls not zeroes for rates', async () => {
    const app = await makeApp();
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `Unused ${Date.now()}`, type: 'security', body: 'x' },
      })
    ).json();

    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/stats` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      used_by: 0,
      agents: [],
      pull_frequency_pct: null,
      accept_rate_pct: null,
      findings_30d: 0,
      findings_by_category: [],
    });
    await app.close();
  });

  it('attaches to an agent and counts only that agent\'s findings matching the skill type', async () => {
    const { db } = pg.handle;
    const app = await makeApp();

    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: `Security rubric ${Date.now()}`, type: 'security', body: 'x' },
      })
    ).json();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: `Stats agent ${Date.now()}`,
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'x',
        },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const [{ id: workspaceId }] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    const [{ id: repoId }] = await db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));

    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: workspaceId!,
        repoId: repoId!,
        number: 900001 + Math.floor(Math.random() * 1000),
        title: 'Stats fixture PR',
        author: 'tester',
        branch: 'feat/stats',
        base: 'main',
        headSha: 'deadbeef',
      })
      .returning();

    const [reviewWithFinding] = await db
      .insert(t.reviews)
      .values({ workspaceId: workspaceId!, prId: pr!.id, agentId: agent.id, kind: 'review' })
      .returning();
    const [reviewWithoutFinding] = await db
      .insert(t.reviews)
      .values({ workspaceId: workspaceId!, prId: pr!.id, agentId: agent.id, kind: 'review' })
      .returning();

    // One finding in the skill's matched category (security), accepted.
    await db.insert(t.findings).values({
      reviewId: reviewWithFinding!.id,
      file: 'a.ts',
      startLine: 1,
      endLine: 1,
      severity: 'WARNING',
      category: 'security',
      title: 'Leaked token',
      rationale: 'x',
      confidence: 0.9,
      acceptedAt: new Date(),
    });
    // One finding NOT in the skill's matched category (style) — must be excluded.
    await db.insert(t.findings).values({
      reviewId: reviewWithFinding!.id,
      file: 'a.ts',
      startLine: 2,
      endLine: 2,
      severity: 'SUGGESTION',
      category: 'style',
      title: 'Naming nit',
      rationale: 'x',
      confidence: 0.5,
    });

    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/stats` });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.used_by).toBe(1);
    expect(stats.agents).toEqual([{ id: agent.id, name: agent.name }]);
    // 1 of 2 reviews by this agent has a matching (security) finding.
    expect(stats.pull_frequency_pct).toBeCloseTo(50, 0);
    expect(stats.accept_rate_pct).toBe(100); // the only actioned matching finding was accepted
    expect(stats.findings_30d).toBe(1);
    expect(stats.findings_by_category).toEqual([{ category: 'security', count: 1 }]);
    await app.close();
  });
});
