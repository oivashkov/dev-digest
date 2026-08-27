/* CaseEditorModal/helpers.ts — JSON validation, PR-meta merge, files
   parsing, and the out-of-hunk warning (AC 78-79).

   DEVIATION (flagged in this step's report): AC 78 says to compute the
   warning "with reviewer-core's exported buildLineIndex" — but
   `reviewer-core/src/index.ts` does NOT export `buildLineIndex` (it's used
   only internally by `grounding.ts`/`output/to-review.ts`), and `client/`
   has no tsconfig path alias to `@devdigest/reviewer-core` at all (that
   package is server-only — see `client/vitest.config.ts` /
   `client/tsconfig.json`, neither declares one). Both premises the plan
   built this AC's implementation note on turned out false once this step
   actually reached them. `reviewer-core/` is outside this step's Owned
   paths, so rather than add an export there, this file reimplements JUST
   `buildLineIndex`'s FALLBACK branch (whole-hunk-range coverage, not the
   line-by-line `newLineNumbers` branch) — enough to answer "does this
   [start_line, end_line] intersect any hunk", which is all a save-time,
   non-blocking warning needs. */
import type { EvalExpectationInput } from "@devdigest/shared";

export function parseExpectedOutput(text: string): { valid: boolean; value: EvalExpectationInput[] } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return { valid: false, value: [] };
    return { valid: true, value: parsed as EvalExpectationInput[] };
  } catch {
    return { valid: false, value: [] };
  }
}

/** Merge edited title/body into whatever `input_meta` already held (e.g. the
 *  provenance fields AC 16 writes for a finding-created case) rather than
 *  clobbering it. */
export function mergeInputMeta(existing: unknown, title: string, body: string): Record<string, unknown> {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  return { ...base, title, body };
}

/** One path per line, blank lines dropped — the simplest authoring UX for a
 *  field (`input_files`) with no fixed shape (`z.unknown()` on the given
 *  contract; the spec names it only as "the PR's changed-file list, or
 *  author-entered", with no field-level i18n placeholder to imply a richer
 *  structure). */
export function parseFilesText(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function filesToText(files: unknown): string {
  if (!Array.isArray(files)) return "";
  return files.filter((f): f is string => typeof f === "string").join("\n");
}

// ---- Out-of-hunk warning (AC 78-79) — see the file-level DEVIATION note ----

interface HunkRange {
  file: string;
  start: number;
  end: number;
}

/** Extract `@@ -a,b +c,d @@` hunk headers per file from a raw unified diff.
 *  Mirrors `buildLineIndex`'s fallback branch: the whole declared new-range
 *  counts as covered (no line-by-line +/context distinction). */
export function parseHunkRanges(diffText: string): HunkRange[] {
  const ranges: HunkRange[] = [];
  let currentFile: string | null = null;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim();
      currentFile = raw === "/dev/null" ? null : raw.replace(/^[ab]\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && currentFile) {
      const newStart = Number(hunk[1]);
      const newLines = hunk[2] !== undefined ? Number(hunk[2]) : 1;
      ranges.push({ file: currentFile, start: newStart, end: newStart + Math.max(newLines, 1) - 1 });
    }
  }
  return ranges;
}

function intersectsAnyHunk(ranges: HunkRange[], file: string, start: number, end: number): boolean {
  return ranges.some((r) => r.file === file && r.start <= end && start <= r.end);
}

export interface OutOfHunkWarning {
  file: string;
  line: number;
}

/** Entries whose [start_line, end_line] falls outside every hunk of the
 *  given diff (AC 78) — `end_line` defaults to `start_line` when omitted,
 *  matching the server's own matching rule (AC 37). Non-blocking by design
 *  (AC 79) — callers still persist the case regardless of this result. */
export function findOutOfHunkExpectations(
  diffText: string,
  expectations: EvalExpectationInput[],
): OutOfHunkWarning[] {
  const ranges = parseHunkRanges(diffText);
  const warnings: OutOfHunkWarning[] = [];
  for (const exp of expectations) {
    if (!exp.file || typeof exp.start_line !== "number") continue;
    const end = exp.end_line ?? exp.start_line;
    if (!intersectsAnyHunk(ranges, exp.file, exp.start_line, end)) {
      warnings.push({ file: exp.file, line: exp.start_line });
    }
  }
  return warnings;
}
