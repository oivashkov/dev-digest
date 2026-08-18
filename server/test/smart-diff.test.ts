/**
 * SmartDiff — pure classifier + builder (server/src/modules/reviews/smart-diff.ts).
 * Hermetic, no I/O: `classifyFile` fixtures across multiple stacks (per
 * docs/plans/smart-diff.md §2/"Ризики" — patterns must be framework-agnostic,
 * not JS-only) and `buildSmartDiff`'s group ordering, finding_lines dedup, and
 * provisional split_suggestion. `buildSmartDiff` itself never sees a
 * `dismissedAt` field (only `{file, start_line, end_line}`) — dismissed-finding
 * exclusion happens one layer up, in `ReviewService.getSmartDiff`
 * (`service.ts`), and is covered there by `reviews-smart-diff-routes.it.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { classifyFile, buildSmartDiff, type SmartDiffFileInput, type SmartDiffFindingInput } from '../src/modules/reviews/smart-diff.js';
import { SmartDiff } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// classifyFile
// ---------------------------------------------------------------------------

describe('classifyFile', () => {
  const boilerplateCases: [string, string][] = [
    ['package-lock.json', 'npm lockfile'],
    ['pnpm-lock.yaml', 'pnpm lockfile'],
    ['yarn.lock', 'yarn lockfile'],
    ['go.sum', 'go lockfile'],
    ['Cargo.lock', 'rust lockfile'],
    ['requirements.txt', 'python manifest'],
    ['pyproject.toml', 'python manifest'],
    ['src/utils/bundle.min.js', 'minified asset'],
    ['src/__snapshots__/x.snap', 'jest snapshot dir'],
    ['db/migrations/0001_x.sql', 'auto-generated migration'],
    ['messages/en/app.json', 'i18n catalog'],
  ];

  it.each(boilerplateCases)('classifies %s (%s) as boilerplate', (path) => {
    expect(classifyFile(path)).toBe('boilerplate');
  });

  const wiringCases: [string, string][] = [
    ['src/index.ts', 'entrypoint'],
    ['config.ts', 'config'],
    ['server.ts', 'server entrypoint'],
    ['src/platform/container.ts', 'DI container'],
    ['app/urls.py', 'django urls'],
    ['app/asgi.py', 'django asgi'],
    ['src/modules/foo/foo.module.ts', 'nest module'],
  ];

  it.each(wiringCases)('classifies %s (%s) as wiring', (path) => {
    expect(classifyFile(path)).toBe('wiring');
  });

  it('classifies an ordinary business-logic file as core', () => {
    expect(classifyFile('src/modules/foo/service.ts')).toBe('core');
  });

  it('classifies a brand-new business-logic file with no special shape as core (the fallback bucket)', () => {
    expect(classifyFile('src/modules/payments/refund-calculator.ts')).toBe('core');
  });

  it('evaluates boilerplate before wiring when a basename matches both patterns', () => {
    // "config.sql" under db/migrations/ matches BOTH the migrations rule
    // (boilerplate) and the wiring basename rule (`config.*`) — boilerplate
    // must win, per the documented evaluation order boilerplate -> wiring -> core.
    expect(classifyFile('db/migrations/config.sql')).toBe('boilerplate');
  });
});

// ---------------------------------------------------------------------------
// buildSmartDiff
// ---------------------------------------------------------------------------

function file(path: string, additions = 1, deletions = 0): SmartDiffFileInput {
  return { path, additions, deletions };
}

describe('buildSmartDiff', () => {
  it('groups files core -> wiring -> boilerplate and preserves original PR order within each group', () => {
    // Deliberately interleaved input order: wiring, boilerplate, core, core,
    // wiring — to prove grouping re-sorts by role, not by insertion order.
    const files = [
      file('src/index.ts'), // wiring
      file('package-lock.json'), // boilerplate
      file('src/modules/b/service.ts'), // core
      file('src/modules/a/service.ts'), // core
      file('config.ts'), // wiring
    ];

    const result = buildSmartDiff(files, []);

    expect(result.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    const core = result.groups.find((g) => g.role === 'core')!;
    const wiring = result.groups.find((g) => g.role === 'wiring')!;
    const boilerplate = result.groups.find((g) => g.role === 'boilerplate')!;
    // Original PR order preserved within each group.
    expect(core.files.map((f) => f.path)).toEqual(['src/modules/b/service.ts', 'src/modules/a/service.ts']);
    expect(wiring.files.map((f) => f.path)).toEqual(['src/index.ts', 'config.ts']);
    expect(boilerplate.files.map((f) => f.path)).toEqual(['package-lock.json']);
  });

  it('dedupes and sorts finding_lines per file from unordered, repeated start_line findings', () => {
    const files = [file('src/modules/a/service.ts')];
    const findings: SmartDiffFindingInput[] = [
      { file: 'src/modules/a/service.ts', start_line: 40, end_line: 40 },
      { file: 'src/modules/a/service.ts', start_line: 10, end_line: 12 },
      { file: 'src/modules/a/service.ts', start_line: 40, end_line: 41 }, // duplicate start_line, different end_line
      { file: 'src/modules/a/service.ts', start_line: 25 },
    ];

    const result = buildSmartDiff(files, findings);

    const core = result.groups.find((g) => g.role === 'core')!;
    expect(core.files[0]!.finding_lines).toEqual([10, 25, 40]);
  });

  it('leaves finding_lines empty for a file with no matching findings, and ignores findings for files not in the diff', () => {
    const files = [file('src/modules/a/service.ts')];
    const findings: SmartDiffFindingInput[] = [{ file: 'src/modules/other/unrelated.ts', start_line: 5 }];

    const result = buildSmartDiff(files, findings);

    const core = result.groups.find((g) => g.role === 'core')!;
    expect(core.files[0]!.finding_lines).toEqual([]);
  });

  it('computes total_lines as the real sum of additions+deletions across all files', () => {
    const files = [file('a.ts', 10, 3), file('b.ts', 4, 1), file('package-lock.json', 100, 50)];

    const result = buildSmartDiff(files, []);

    expect(result.split_suggestion.total_lines).toBe(10 + 3 + 4 + 1 + 100 + 50);
  });

  it('too_big is false at/under the provisional 500-line threshold and true just over it', () => {
    const atThreshold = buildSmartDiff([file('a.ts', 300, 200)], []); // 500
    expect(atThreshold.split_suggestion.total_lines).toBe(500);
    expect(atThreshold.split_suggestion.too_big).toBe(false);

    const overThreshold = buildSmartDiff([file('a.ts', 300, 201)], []); // 501
    expect(overThreshold.split_suggestion.too_big).toBe(true);
  });

  it('proposes one split per top-level path segment that has more than one changed file, and skips single-file segments', () => {
    const files = [
      file('src/modules/a/service.ts'),
      file('src/modules/b/service.ts'),
      file('docs/readme.md'), // top-level segment "docs" has only one file
      file('server.ts'), // top-level segment is the bare filename itself
    ];

    const result = buildSmartDiff(files, []);

    expect(result.split_suggestion.proposed_splits).toEqual([
      { name: 'src', files: ['src/modules/a/service.ts', 'src/modules/b/service.ts'] },
    ]);
  });

  it('returns empty groups and a zeroed split_suggestion for no files', () => {
    const result = buildSmartDiff([], []);

    expect(result.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(result.groups.every((g) => g.files.length === 0)).toBe(true);
    expect(result.split_suggestion).toEqual({ too_big: false, total_lines: 0, proposed_splits: [] });
  });

  it('round-trips through the real SmartDiff Zod contract without throwing', () => {
    const files = [file('src/index.ts'), file('package-lock.json', 200, 400), file('src/modules/a/service.ts')];
    const findings: SmartDiffFindingInput[] = [{ file: 'src/modules/a/service.ts', start_line: 7 }];

    const result = buildSmartDiff(files, findings);

    expect(() => SmartDiff.parse(result)).not.toThrow();
  });
});
