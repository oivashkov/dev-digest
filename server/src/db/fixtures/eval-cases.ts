import type { EvalExpectationInput } from '@devdigest/shared';

/**
 * Seed fixture: ≥8 frozen eval cases for the Security Reviewer demo agent
 * (SPEC-04 `specs/04-eval-pipeline.md` AC 1). Six `must_find` cases (a real
 * vulnerability the agent should catch) and two `must_not_flag` cases (safe
 * code the agent should NOT flag), each carrying a small, self-consistent
 * unified diff whose hunk genuinely contains the expected finding's line
 * range — an expectation outside every hunk is unpassable by construction
 * (spec, Edge cases), so `unifiedDiff()` below computes `oldLines`/`newLines`
 * from the actual line list instead of being hand-counted, and each case's
 * `expected_output` range is derived from the same line list via
 * `newLineNumberAt()` rather than eyeballed, so the two can never drift.
 *
 * Consumed by `src/db/seed.ts`, which inserts these under the Security
 * Reviewer agent's id with `owner_kind: 'agent'`, respecting the
 * `eval_cases (owner_id, name)` unique constraint via `onConflictDoNothing`
 * so `pnpm db:seed` stays idempotent (`server/INSIGHTS.md`, 2026-08-12 seed
 * trap: direct `db.insert()` here bypasses repository side effects, which is
 * fine for `eval_cases` — it has none).
 */

// ---------------------------------------------------------------------------
// Diff-building helpers (local to this fixture file — not exported)
// ---------------------------------------------------------------------------

interface DiffLine {
  kind: 'add' | 'del' | 'ctx';
  text: string;
}

const ctx = (text: string): DiffLine => ({ kind: 'ctx', text });
const add = (text: string): DiffLine => ({ kind: 'add', text });

/**
 * Builds a minimal single-hunk unified diff for one file, computing
 * `oldLines`/`newLines` from `lines` itself rather than a hand-typed count —
 * matches the shape `src/adapters/git/diff-parser.ts#parseUnifiedDiff`
 * expects (`diff --git` / `--- a/` / `+++ b/` / `@@ -o,ol +n,nl @@`).
 */
function unifiedDiff(path: string, oldStart: number, newStart: number, lines: DiffLine[]): string {
  const oldLines = lines.filter((l) => l.kind !== 'add').length;
  const newLines = lines.filter((l) => l.kind !== 'del').length;
  const body = lines.map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`).join('\n');
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`,
    body,
  ].join('\n');
}

/**
 * The new-side line number `parseUnifiedDiff` assigns to `lines[index]` —
 * mirrors that parser's `newLineCursor` (increments for every `ctx`/`add`
 * line, never for `del`). Only meaningful when `lines[index]` is `ctx`/`add`
 * (every case below only targets those).
 */
function newLineNumberAt(newStart: number, lines: DiffLine[], index: number): number {
  let cursor = newStart;
  for (let i = 0; i < index; i++) {
    if (lines[i]!.kind !== 'del') cursor++;
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// Fixture shape
// ---------------------------------------------------------------------------

export interface SecurityReviewerEvalCaseFixture {
  name: string;
  inputDiff: string;
  inputFiles: string[];
  inputMeta: Record<string, unknown>;
  expectedOutput: EvalExpectationInput[];
  notes: string;
}

// ---------------------------------------------------------------------------
// Case 1 — must_find: hardcoded Stripe secret key
// ---------------------------------------------------------------------------

const case1Lines: DiffLine[] = [
  ctx(`export const paymentsConfig = {`),
  add(`  stripeSecretKey: 'sk_live_FIXTURE_NOT_A_REAL_KEY_0000000000000000',`),
  add(`  webhookSecret: 'whsec_FIXTURE_NOT_A_REAL_SECRET_00000000',`),
  ctx(`  region: 'us-east-1',`),
  ctx(`  timeoutMs: 5000,`),
  ctx(`};`),
];

// ---------------------------------------------------------------------------
// Case 2 — must_find: SQL injection via string concatenation
// ---------------------------------------------------------------------------

const case2Lines: DiffLine[] = [
  ctx(`  return db.query('SELECT * FROM users WHERE id = $1', [id]);`),
  ctx(`}`),
  ctx(``),
  add(`export async function getUserByEmail(email: string) {`),
  add(`  const sql = \`SELECT * FROM users WHERE email = '\${email}'\`;`),
  add(`  return db.query(sql);`),
  add(`}`),
  ctx(``),
];

// ---------------------------------------------------------------------------
// Case 3 — must_find: SSRF via unvalidated fetch(url)
// ---------------------------------------------------------------------------

const case3Lines: DiffLine[] = [
  ctx(`  app.get('/health', async () => ({ status: 'ok' }));`),
  ctx(``),
  add(`  app.post('/webhooks/fetch-preview', async (req, reply) => {`),
  add(`    const { url } = req.body as { url: string };`),
  add(`    const res = await fetch(url);`),
  add(`    const body = await res.text();`),
  add(`    return reply.send({ preview: body.slice(0, 500) });`),
  add(`  });`),
  ctx(``),
  ctx(`  app.post('/webhooks/incoming', async (req, reply) => {`),
];

// ---------------------------------------------------------------------------
// Case 4 — must_find: weak crypto (MD5 for password hashing)
// ---------------------------------------------------------------------------

const case4Lines: DiffLine[] = [
  ctx(`import crypto from 'node:crypto';`),
  ctx(``),
  add(`export function hashPassword(password: string): string {`),
  add(`  return crypto.createHash('md5').update(password).digest('hex');`),
  add(`}`),
];

// ---------------------------------------------------------------------------
// Case 5 — must_find: path traversal in a file-download handler
// ---------------------------------------------------------------------------

const case5Lines: DiffLine[] = [
  ctx(`import { join } from 'node:path';`),
  ctx(``),
  add(`export async function downloadFile(req: FastifyRequest, reply: FastifyReply) {`),
  add(`  const { filename } = req.query as { filename: string };`),
  add(`  const filePath = join(UPLOAD_DIR, filename);`),
  add(`  return reply.sendFile(filePath);`),
  add(`}`),
];

// ---------------------------------------------------------------------------
// Case 6 — must_find: command injection via unsanitized interpolation
// ---------------------------------------------------------------------------

const case6Lines: DiffLine[] = [
  ctx(`import { exec } from 'node:child_process';`),
  ctx(``),
  add(`export function runBackup(targetDir: string) {`),
  add(`  exec(\`tar -czf backup.tar.gz \${targetDir}\`);`),
  add(`}`),
];

// ---------------------------------------------------------------------------
// Case 7 — must_not_flag: safe parameterized query (no vulnerability)
// ---------------------------------------------------------------------------

const case7Lines: DiffLine[] = [
  ctx(`import { db } from '../client.js';`),
  ctx(``),
  add(`export async function getOrderById(id: string) {`),
  add(`  return db.query('SELECT * FROM orders WHERE id = $1', [id]);`),
  add(`}`),
];

// ---------------------------------------------------------------------------
// Case 8 — must_not_flag: safe allowlisted redirect (no open-redirect bug)
// ---------------------------------------------------------------------------

const case8Lines: DiffLine[] = [
  ctx(`import { ALLOWED_REDIRECT_HOSTS } from '../../config/hosts.js';`),
  ctx(``),
  add(`export async function handleRedirect(req: FastifyRequest, reply: FastifyReply) {`),
  add(`  const { to } = req.query as { to: string };`),
  add(`  const url = new URL(to);`),
  add(`  if (!ALLOWED_REDIRECT_HOSTS.includes(url.host)) {`),
  add(`    return reply.code(400).send({ error: 'invalid redirect host' });`),
  add(`  }`),
  add(`  return reply.redirect(url.toString());`),
  add(`}`),
];

// ---------------------------------------------------------------------------
// Assembled fixtures
// ---------------------------------------------------------------------------

export const SECURITY_REVIEWER_EVAL_CASES: SecurityReviewerEvalCaseFixture[] = [
  {
    name: 'hardcoded-stripe-secret-key',
    inputDiff: unifiedDiff('src/config/payments.ts', 1, 1, case1Lines),
    inputFiles: ['src/config/payments.ts'],
    inputMeta: {
      pr_title: 'Add payments config defaults',
      pr_number: 9001,
      source: 'seed-fixture',
    },
    expectedOutput: [
      {
        expect: 'must_find',
        file: 'src/config/payments.ts',
        start_line: newLineNumberAt(1, case1Lines, 1),
        end_line: newLineNumberAt(1, case1Lines, 2),
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
      },
    ],
    notes: 'A literal live Stripe secret + webhook secret committed in plaintext config.',
  },
  {
    name: 'sql-injection-string-concat',
    inputDiff: unifiedDiff('src/db/queries/users.ts', 10, 10, case2Lines),
    inputFiles: ['src/db/queries/users.ts'],
    inputMeta: {
      pr_title: 'Add getUserByEmail lookup',
      pr_number: 9002,
      source: 'seed-fixture',
    },
    expectedOutput: [
      {
        expect: 'must_find',
        file: 'src/db/queries/users.ts',
        start_line: newLineNumberAt(10, case2Lines, 4),
        end_line: newLineNumberAt(10, case2Lines, 4),
        severity: 'CRITICAL',
        category: 'security',
        title: 'SQL injection via template-string interpolation',
      },
    ],
    notes: 'Untrusted `email` interpolated directly into a SQL string instead of parameterized.',
  },
  {
    name: 'ssrf-unvalidated-fetch-url',
    inputDiff: unifiedDiff('src/api/public/webhooks.ts', 20, 20, case3Lines),
    inputFiles: ['src/api/public/webhooks.ts'],
    inputMeta: {
      pr_title: 'Add webhook preview endpoint',
      pr_number: 9003,
      source: 'seed-fixture',
    },
    expectedOutput: [
      {
        expect: 'must_find',
        file: 'src/api/public/webhooks.ts',
        start_line: newLineNumberAt(20, case3Lines, 2),
        end_line: newLineNumberAt(20, case3Lines, 6),
        severity: 'CRITICAL',
        category: 'security',
        title: 'SSRF via unvalidated user-supplied URL',
      },
    ],
    notes: 'Public endpoint fetches an attacker-controlled URL with no host allowlist.',
  },
  {
    name: 'weak-crypto-md5-password-hash',
    inputDiff: unifiedDiff('src/auth/password.ts', 1, 1, case4Lines),
    inputFiles: ['src/auth/password.ts'],
    inputMeta: {
      pr_title: 'Add password hashing helper',
      pr_number: 9004,
      source: 'seed-fixture',
    },
    expectedOutput: [
      {
        expect: 'must_find',
        file: 'src/auth/password.ts',
        start_line: newLineNumberAt(1, case4Lines, 3),
        end_line: newLineNumberAt(1, case4Lines, 3),
        severity: 'CRITICAL',
        category: 'security',
        title: 'MD5 used for password hashing',
      },
    ],
    notes: 'MD5 is not a password hash — no salt, no work factor, broken and fast to brute-force.',
  },
  {
    name: 'path-traversal-download-handler',
    inputDiff: unifiedDiff('src/files/download.ts', 1, 1, case5Lines),
    inputFiles: ['src/files/download.ts'],
    inputMeta: {
      pr_title: 'Add file download endpoint',
      pr_number: 9005,
      source: 'seed-fixture',
    },
    expectedOutput: [
      {
        expect: 'must_find',
        file: 'src/files/download.ts',
        start_line: newLineNumberAt(1, case5Lines, 3),
        end_line: newLineNumberAt(1, case5Lines, 4),
        severity: 'CRITICAL',
        category: 'security',
        title: 'Path traversal via unsanitized filename query param',
      },
    ],
    notes: 'User-supplied `filename` joined into a filesystem path with no traversal guard.',
  },
  {
    name: 'command-injection-exec-interpolation',
    inputDiff: unifiedDiff('src/ops/backup.ts', 1, 1, case6Lines),
    inputFiles: ['src/ops/backup.ts'],
    inputMeta: {
      pr_title: 'Add backup script runner',
      pr_number: 9006,
      source: 'seed-fixture',
    },
    expectedOutput: [
      {
        expect: 'must_find',
        file: 'src/ops/backup.ts',
        start_line: newLineNumberAt(1, case6Lines, 3),
        end_line: newLineNumberAt(1, case6Lines, 3),
        severity: 'CRITICAL',
        category: 'security',
        title: 'Command injection via unsanitized shell interpolation',
      },
    ],
    notes: '`targetDir` is interpolated straight into a shell command string passed to `exec`.',
  },
  {
    name: 'safe-parameterized-query-no-flag',
    inputDiff: unifiedDiff('src/db/queries/orders.ts', 1, 1, case7Lines),
    inputFiles: ['src/db/queries/orders.ts'],
    inputMeta: {
      pr_title: 'Add getOrderById lookup',
      pr_number: 9007,
      source: 'seed-fixture',
    },
    expectedOutput: [
      {
        expect: 'must_not_flag',
        file: 'src/db/queries/orders.ts',
        start_line: newLineNumberAt(1, case7Lines, 2),
        end_line: newLineNumberAt(1, case7Lines, 4),
      },
    ],
    notes: 'Already-parameterized query ($1 placeholder) — must not be flagged as injectable.',
  },
  {
    name: 'safe-allowlisted-redirect-no-flag',
    inputDiff: unifiedDiff('src/api/public/redirect.ts', 1, 1, case8Lines),
    inputFiles: ['src/api/public/redirect.ts'],
    inputMeta: {
      pr_title: 'Add allowlisted external redirect endpoint',
      pr_number: 9008,
      source: 'seed-fixture',
    },
    expectedOutput: [
      {
        expect: 'must_not_flag',
        file: 'src/api/public/redirect.ts',
        start_line: newLineNumberAt(1, case8Lines, 2),
        end_line: newLineNumberAt(1, case8Lines, 9),
      },
    ],
    notes: 'Redirect target is checked against an explicit host allowlist before use — not an open redirect.',
  },
];
