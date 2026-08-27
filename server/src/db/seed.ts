import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { extractSkillCore } from '../modules/skills/helpers.js';
import { SECURITY_REVIEWER_EVAL_CASES } from './fixtures/eval-cases.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, five built-in agents (General + Security + Performance
 * + Test Quality + API Contract), all on the default openrouter/deepseek-v4
 * -flash provider+model, a handful of skills linked to the two newest
 * agents — one of them (`pr-quality-rubric`) seeded through the actual
 * import/extract path (`extractSkillCore`) against a fixture file, not
 * hand-written, so the seed itself exercises the import code path — and
 * ≥8 frozen eval cases for the Security Reviewer agent (SPEC-04 AC 1,
 * `fixtures/eval-cases.ts`).
 *
 * Course lessons populate the remaining tables (conventions, memory, …) once
 * their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Flags untested branches, missed edge cases, over-mocking, and flaky patterns.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Catches breaking changes to route request/response shapes before they ship.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- eval cases (Security Reviewer demo case set, SPEC-04 AC 1) ----
  // Direct db.insert() here bypasses repository side effects, same as the
  // skills-seeding loop below — safe for eval_cases since it has none
  // (server/INSIGHTS.md, 2026-08-12 seed trap). onConflictDoNothing targets
  // the (owner_id, name) unique constraint (Step 2's migration) explicitly
  // so re-running `pnpm db:seed` against an already-seeded DB stays a no-op
  // instead of assuming a clean database.
  const [securityReviewer] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
  if (securityReviewer) {
    const evalCaseRows: Array<typeof t.evalCases.$inferInsert> = SECURITY_REVIEWER_EVAL_CASES.map(
      (c) => ({
        workspaceId,
        ownerKind: 'agent' as const,
        ownerId: securityReviewer.id,
        name: c.name,
        inputDiff: c.inputDiff,
        inputFiles: c.inputFiles,
        inputMeta: c.inputMeta,
        expectedOutput: c.expectedOutput,
        notes: c.notes,
      }),
    );
    await db
      .insert(t.evalCases)
      .values(evalCaseRows)
      .onConflictDoNothing({ target: [t.evalCases.ownerId, t.evalCases.name] });
  }

  // ---- skills (linked to the two newest agents) ----
  // Three hand-written + one seeded through the real import/extract path
  // (extractSkillCore against a fixture file), so "at least one skill goes
  // through import" is actually exercised, not just labeled.
  const prQualityRubric = extractSkillCore(
    'pr-quality-rubric.md',
    readFileSync(join(FIXTURES_DIR, 'pr-quality-rubric.md')),
  );

  const seedSkills: Array<typeof t.skills.$inferInsert> = [
    {
      workspaceId,
      name: 'Test coverage nudge',
      description: 'Flag a PR that changes behavior with no accompanying test.',
      type: 'custom',
      source: 'manual',
      body:
        'If this diff changes observable behavior (a new branch, a changed return value, ' +
        'a new error path) and the diff contains no corresponding test change, say so ' +
        'explicitly as its own finding — do not let it slide because "the rest of the PR ' +
        'looks fine." Name the exact behavior that has no test.',
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: 'No over-mocking',
      description: 'Flag tests whose mocks make the assertion unable to fail.',
      type: 'convention',
      source: 'manual',
      body:
        'A test that mocks the exact function/module it claims to test, or whose mock ' +
        'reimplements the real logic well enough that the test can never observe a real ' +
        'regression, is not proving anything. Flag it and name what real behavior the mock ' +
        'is hiding.',
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: 'API breaking-change gate',
      description: 'Block a PR that removes/retypes a response field or narrows a request field.',
      type: 'rubric',
      source: 'manual',
      body:
        'Before approving any route change, restate the OLD request/response shape and the ' +
        'NEW one side by side. If a response field was removed or retyped, or a request ' +
        'field went from optional to required with no default, that is CRITICAL regardless ' +
        'of what the PR description claims about compatibility.',
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: prQualityRubric.name,
      description: 'General PR quality baseline — applied alongside whatever else this agent checks.',
      // extractSkillCore always defaults `type` to 'custom' (it can't infer a
      // semantic category from content) — this override is exactly what a
      // human confirming the ImportSkillDialog preview would do before saving.
      type: 'rubric',
      source: prQualityRubric.source,
      body: prQualityRubric.body,
      enabled: true,
      version: 1,
      evidenceFiles: prQualityRubric.evidence_files,
    },
  ];
  const skillIdByName = new Map<string, string>();
  for (const sk of seedSkills) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, sk.name)));
    const row = existing ?? (await db.insert(t.skills).values(sk).returning())[0];
    skillIdByName.set(sk.name, row!.id);
    // Seeded skills are inserted directly (not through SkillsRepository), so
    // snapshot v1 here too — otherwise the Versions tab shows "no history"
    // for every demo skill, which is misleading (a real create always does).
    if (!existing) {
      await db
        .insert(t.skillVersions)
        .values({ skillId: row!.id, version: 1, body: row!.body, summary: 'Initial version' })
        .onConflictDoNothing();
    }
  }

  const agentIdByName = new Map<string, string>();
  for (const name of ['Test Quality Reviewer', 'API Contract Reviewer']) {
    const [row] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, name)));
    if (row) agentIdByName.set(name, row.id);
  }

  const seedLinks: Array<{ agent: string; skill: string; order: number }> = [
    { agent: 'Test Quality Reviewer', skill: 'Test coverage nudge', order: 0 },
    { agent: 'Test Quality Reviewer', skill: 'No over-mocking', order: 1 },
    { agent: 'Test Quality Reviewer', skill: prQualityRubric.name, order: 2 },
    { agent: 'API Contract Reviewer', skill: 'API breaking-change gate', order: 0 },
    { agent: 'API Contract Reviewer', skill: prQualityRubric.name, order: 1 },
  ];
  for (const link of seedLinks) {
    const agentId = agentIdByName.get(link.agent);
    const skillId = skillIdByName.get(link.skill);
    if (!agentId || !skillId) continue;
    await db
      .insert(t.agentSkills)
      .values({ agentId, skillId, order: link.order })
      .onConflictDoNothing();
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
