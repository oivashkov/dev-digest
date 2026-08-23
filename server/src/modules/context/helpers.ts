import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { isContextDocPathShape, type SpecDocType } from '@devdigest/shared';
import { isWithinClone } from '../reviews/intent.js';

/**
 * Project Context path guards — SPEC-01's "Path safety" acceptance criteria.
 *
 * `isContextDocPathShape` (shape allowlist: `**\/specs/**\/*.md`,
 * `**\/docs/**\/*.md`, `**\/INSIGHTS.md`) lives in `@devdigest/shared` (Q4) so
 * it can validate the `SpecPath` Zod schema at the route boundary AND be
 * reused here, composed with the UNCHANGED `isWithinClone` imported from
 * `server/src/modules/reviews/intent.ts` — the same two-guard shape as that
 * module's own `isSafePlanRefPath`, but a project-context-local allowlist
 * (do not widen `isAllowedPlanRefShape` itself; that guards a different
 * feature's paths). Exported so traversal payloads are unit-testable without
 * a real clone, following `intent.ts:251-256`'s own precedent.
 */
export function isSafeContextDocPath(clonePath: string, relPath: string): boolean {
  return isContextDocPathShape(relPath) && isWithinClone(clonePath, relPath);
}

/**
 * A SECOND, stronger containment check for the moment right before a
 * document is actually read — `isWithinClone` above is purely lexical
 * (`path.resolve`, no filesystem access), so it does NOT catch a path whose
 * FINAL component is a symlink pointing outside the clone (SPEC-01's edge
 * case: "Symlinked file or directory inside the clone pointing outside it").
 * `walkClone` never follows symlinks during discovery, so this only matters
 * for a path an attacker submits directly to the attach API without it ever
 * appearing in a discovery list. Resolves BOTH the clone root and the
 * candidate file through `fs.realpath` (which does follow symlinks) and
 * re-checks containment against the real, on-disk paths. Returns `false` on
 * any error (file doesn't exist, permission denied, etc.) — fail closed.
 */
export async function isRealpathWithinClone(clonePath: string, fullPath: string): Promise<boolean> {
  try {
    const [realClone, realTarget] = await Promise.all([realpath(resolve(clonePath)), realpath(fullPath)]);
    return realTarget === realClone || realTarget.startsWith(realClone + sep);
  } catch {
    return false;
  }
}

const INSIGHTS_FILE_RE = /(^|\/)INSIGHTS\.md$/;
const SPECS_DIR_RE = /(^|\/)specs\//;

/** Document "type" tag, derived from which search-root pattern matched
 *  (Q4). Only called on paths that already passed `isContextDocPathShape`,
 *  so the three branches are exhaustive for anything reaching this. */
export function classifyContextDocType(path: string): SpecDocType {
  if (INSIGHTS_FILE_RE.test(path)) return 'insights';
  if (SPECS_DIR_RE.test(path)) return 'specs';
  return 'docs';
}

/** Normalize a path for de-duplication / deterministic sort (Q3, Q13) —
 *  posix separators, no leading `./`. Paths reaching here are already
 *  repo-relative posix paths (from `walkClone`/the attach routes' Zod
 *  validation), so this is defensive normalization, not a real conversion. */
export function normalizeContextPath(path: string): string {
  return path.replace(/^\.\//, '').split('\\').join('/');
}
