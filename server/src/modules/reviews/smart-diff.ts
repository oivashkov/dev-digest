import type { ProposedSplit, SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';

/**
 * SmartDiff — pure classifier + builder, per `docs/plans/smart-diff.md` §2.
 *
 * NO I/O, NO imports of `fastify`/`db`/`reviewer-core`. Deliberately lives in
 * the `reviews` server module rather than `reviewer-core`: this is a
 * presentation concern (file ordering for the reviewer's UI), not part of the
 * `diff → prompt → LLM → grounded findings` pipeline (`reviewer-core/README.md`).
 * Direct precedent: `tierFor()`/`isAllowedPlanRefShape()` in `intent.ts`, both
 * pure classifiers that live here for the same reason.
 *
 * Classification is by path/filename shape ONLY — never by diff size or
 * content (explicitly rejected size-override alternative, see plan §"Архітек-
 * турні рішення" point 1). Framework-agnostic: this app reviews arbitrary
 * imported repos, not just itself, so patterns cover non-JS stacks too
 * (Python, Go, Rust, Ruby, PHP, …).
 */

// ---------------------------------------------------------------------------
// classifyFile — regex-allowlist, evaluation order boilerplate → wiring →
// core (first match wins). Style follows `isAllowedPlanRefShape` (intent.ts).
// ---------------------------------------------------------------------------

/** Lockfiles across common package managers. */
const LOCKFILE_RE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock|Gemfile\.lock|composer\.lock)$/;

/** Dependency manifests. */
const MANIFEST_RE = /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|requirements\.txt)$/;

/** Generated / vendored / build output directories. */
const GENERATED_DIR_RE = /(^|\/)(generated|vendor|dist|build|\.next|__generated__)(\/|$)/;

/** Snapshot / fixture / test-data paths. */
const SNAPSHOT_FIXTURE_RE = /(^|\/)(__snapshots__|fixtures|testdata)(\/|$)|\.snap$/;

/** Minified / bundled assets. */
const MINIFIED_RE = /\.min\.(js|css)$/;

/** Auto-generated DB migrations — never hand-written, per repo convention
 *  (`server/AGENTS.md`: "Never hand-write a migration file"). */
const MIGRATIONS_RE = /(^|\/)(migrations|db\/migrations)\/.+\.sql$/;

/** i18n message catalogs. */
const I18N_RE = /(^|\/)(locales|i18n)\/|(^|\/)messages\/.+\.json$/;

/** Framework-agnostic entrypoint / wiring filenames (basename-anchored). */
const WIRING_BASENAME_RE =
  /(^|\/)(index|main|server|app|container|config|routes|router)\.[^/]+$|\.module\.ts$|(^|\/)(urls|wsgi|asgi)\.py$/;

export function classifyFile(path: string): SmartDiffRole {
  if (
    LOCKFILE_RE.test(path) ||
    MANIFEST_RE.test(path) ||
    GENERATED_DIR_RE.test(path) ||
    SNAPSHOT_FIXTURE_RE.test(path) ||
    MINIFIED_RE.test(path) ||
    MIGRATIONS_RE.test(path) ||
    I18N_RE.test(path)
  ) {
    return 'boilerplate';
  }
  if (WIRING_BASENAME_RE.test(path)) return 'wiring';
  return 'core';
}

// ---------------------------------------------------------------------------
// buildSmartDiff — groups files by role, computes finding_lines and a
// provisional split_suggestion. Structural inputs only (no Drizzle rows) so
// this is testable without a DB, per plan §2.
// ---------------------------------------------------------------------------

/** Provisional "too big" threshold — not size-tuned, flagged per plan §2 as a
 *  placeholder until a real heuristic is decided. */
const TOO_BIG_LINE_THRESHOLD = 500;

export interface SmartDiffFileInput {
  path: string;
  additions: number;
  deletions: number;
}

export interface SmartDiffFindingInput {
  file: string;
  start_line: number;
  end_line?: number;
}

const GROUP_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

export function buildSmartDiff(files: SmartDiffFileInput[], findings: SmartDiffFindingInput[]): SmartDiff {
  const findingLinesByPath = new Map<string, Set<number>>();
  for (const f of findings) {
    let lines = findingLinesByPath.get(f.file);
    if (!lines) {
      lines = new Set<number>();
      findingLinesByPath.set(f.file, lines);
    }
    lines.add(f.start_line);
  }

  const filesByRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  for (const role of GROUP_ORDER) filesByRole.set(role, []);

  for (const file of files) {
    const role = classifyFile(file.path);
    const lines = findingLinesByPath.get(file.path);
    const smartDiffFile: SmartDiffFile = {
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: lines ? [...lines].sort((a, b) => a - b) : [],
    };
    filesByRole.get(role)!.push(smartDiffFile);
  }

  const groups: SmartDiffGroup[] = GROUP_ORDER.map((role) => ({ role, files: filesByRole.get(role)! }));

  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  // Provisional: one proposed split per top-level path segment with more than
  // one file, `name` = the segment. Not size-tuned and not rendered in the UI
  // yet (plan §"Поза скоупом") — a placeholder shape, not a real heuristic.
  const filesBySegment = new Map<string, string[]>();
  for (const file of files) {
    const segment = file.path.split('/')[0] ?? file.path;
    const bucket = filesBySegment.get(segment);
    if (bucket) bucket.push(file.path);
    else filesBySegment.set(segment, [file.path]);
  }
  const proposedSplits: ProposedSplit[] = [...filesBySegment.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([name, paths]) => ({ name, files: paths }));

  return {
    groups,
    split_suggestion: {
      too_big: totalLines > TOO_BIG_LINE_THRESHOLD,
      total_lines: totalLines,
      proposed_splits: proposedSplits,
    },
  };
}
