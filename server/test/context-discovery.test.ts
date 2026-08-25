/**
 * Project Context (SPEC-01) — hermetic unit tests for the path-shape
 * allowlist and the parameterized `walkClone`. No DB, no git.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { symlink } from 'node:fs/promises';
import { isContextDocPathShape } from '@devdigest/shared';
import { walkClone } from '../src/modules/repo-intel/pipeline/walk.js';
import {
  isSafeContextDocPath,
  isRealpathWithinClone,
  classifyContextDocType,
} from '../src/modules/context/helpers.js';

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (dir && dir !== root) await mkdir(dir, { recursive: true });
  await writeFile(full, contents);
}

describe('isContextDocPathShape (project-context shape allowlist)', () => {
  it('accepts specs/, docs/, and INSIGHTS.md at any depth', () => {
    expect(isContextDocPathShape('specs/x.md')).toBe(true);
    expect(isContextDocPathShape('docs/a/b.md')).toBe(true);
    expect(isContextDocPathShape('INSIGHTS.md')).toBe(true);
    expect(isContextDocPathShape('server/INSIGHTS.md')).toBe(true);
  });

  it('rejects traversal, absolute, and drive-absolute paths', () => {
    expect(isContextDocPathShape('../etc/passwd')).toBe(false);
    expect(isContextDocPathShape('specs/../../etc/passwd')).toBe(false);
    expect(isContextDocPathShape('/etc/passwd')).toBe(false);
    expect(isContextDocPathShape('C:\\x')).toBe(false);
  });

  it('rejects a non-.md file and paths outside the allowed roots', () => {
    expect(isContextDocPathShape('notes.txt')).toBe(false);
    expect(isContextDocPathShape('src/index.ts')).toBe(false);
    expect(isContextDocPathShape('insights/foo.md')).toBe(false); // no insights/ dir convention (Q4)
  });
});

describe('classifyContextDocType', () => {
  it('derives type from the matched pattern', () => {
    expect(classifyContextDocType('specs/x.md')).toBe('specs');
    expect(classifyContextDocType('docs/a/b.md')).toBe('docs');
    expect(classifyContextDocType('INSIGHTS.md')).toBe('insights');
    expect(classifyContextDocType('server/INSIGHTS.md')).toBe('insights');
  });
});

describe('isSafeContextDocPath (shape + clone containment)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'context-guard-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('accepts a shape-allowed path that resolves inside the clone', () => {
    expect(isSafeContextDocPath(root, 'specs/x.md')).toBe(true);
  });
});

describe('isRealpathWithinClone (symlink-aware second guard)', () => {
  let root: string;
  let outside: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'context-realguard-'));
    outside = await mkdtemp(join(tmpdir(), 'context-outside-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('accepts a real file inside the clone', async () => {
    await writeFileAt(root, 'specs/x.md', '# spec');
    expect(await isRealpathWithinClone(root, join(root, 'specs/x.md'))).toBe(true);
  });

  it('rejects a symlink inside the clone whose target escapes it', async () => {
    await writeFileAt(outside, 'secret.md', '# secret');
    await mkdir(join(root, 'specs'), { recursive: true });
    await symlink(join(outside, 'secret.md'), join(root, 'specs', 'x.md'));
    expect(await isRealpathWithinClone(root, join(root, 'specs', 'x.md'))).toBe(false);
  });

  it('fails closed when the target does not exist', async () => {
    expect(await isRealpathWithinClone(root, join(root, 'specs', 'missing.md'))).toBe(false);
  });
});

describe('walkClone — parameterized match option', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'context-walk-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('with no options, returns exactly what it returns today (SUPPORTED_EXT)', async () => {
    await writeFileAt(root, 'src/a.ts', 'export const a = 1;');
    await writeFileAt(root, 'specs/x.md', '# spec');
    const result = await walkClone(root);
    expect(result.files).toEqual(['src/a.ts']);
  });

  it('with a match predicate, filters by the predicate instead of SUPPORTED_EXT', async () => {
    await writeFileAt(root, 'src/a.ts', 'export const a = 1;');
    await writeFileAt(root, 'specs/x.md', '# spec');
    await writeFileAt(root, 'docs/y.md', '# doc');
    await writeFileAt(root, 'INSIGHTS.md', '# insights');
    await writeFileAt(root, 'notes.txt', 'nope');

    const result = await walkClone(root, { match: isContextDocPathShape });
    expect(result.files.sort()).toEqual(['INSIGHTS.md', 'docs/y.md', 'specs/x.md']);
  });

  it('still excludes EXCLUDED_DIRS and enforces the size cap with a custom match', async () => {
    await writeFileAt(root, 'node_modules/specs/x.md', '# should be excluded');
    await writeFileAt(root, 'specs/big.md', 'x'.repeat(10));
    const result = await walkClone(root, { match: isContextDocPathShape, maxFileSize: 5 });
    expect(result.files).toEqual([]);
    expect(result.stats.skippedTooLarge).toBe(1);
  });
});
