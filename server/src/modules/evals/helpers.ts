import type { EvalExpectation } from '@devdigest/shared';
import { EVAL_CASE_NAME_SLUG_MAX_LENGTH } from './constants.js';

/**
 * Pure scoring + deterministic case-name helpers for the `evals` module
 * (SPEC-04 `specs/04-eval-pipeline.md`, ACs 36-46 for scoring, AC 13 for
 * naming). NO I/O, NO `Container`, NO DB — every function here takes plain
 * data and returns plain data, so it's testable without a database
 * (`server/AGENTS.md`'s "Non-functional requirements → Scoring purity").
 *
 * `citation_accuracy` deliberately takes `(keptCount, droppedCount)` rather
 * than a `ReviewOutcome` — `ReviewOutcome.review.findings` is already
 * post-grounding-gate, so the pre-gate total this metric needs only exists
 * on the outcome's sibling `grounding`/`dropped` fields
 * (`reviewer-core/INSIGHTS.md`, 2026-08-26). The runner (Step 4) is
 * responsible for reading those off the outcome and passing the counts in.
 */

// ---------------------------------------------------------------------------
// Match rule (AC 36-37)
// ---------------------------------------------------------------------------

/** The subset of an actual finding's shape the match rule needs — deliberately
 *  narrower than the full `Finding` contract so this stays decoupled from it. */
export interface EvalActualFinding {
  file: string;
  start_line: number;
  end_line: number;
}

/** An expectation's effective `[start_line, end_line]` range — a missing
 *  `end_line` is treated as equal to `start_line` (AC 37). */
function expectationRange(expectation: EvalExpectation): { start: number; end: number } {
  const start = expectation.start_line;
  const end = expectation.end_line ?? start;
  return { start, end };
}

/** Two inclusive integer ranges intersect when neither is entirely before
 *  the other. */
function rangesIntersect(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * An expected entry and an actual finding are **matched** when their `file`
 * values are equal AND their `[start_line, end_line]` ranges intersect
 * (AC 36). `severity`/`category`/`title` never participate (AC 47).
 */
export function matchesExpectation(
  expectation: EvalExpectation,
  actual: EvalActualFinding,
): boolean {
  if (expectation.file !== actual.file) return false;
  const { start, end } = expectationRange(expectation);
  return rangesIntersect(start, end, actual.start_line, actual.end_line);
}

// ---------------------------------------------------------------------------
// Precedence helper (AC 42-43) — shared by recall, precision, and pass
// ---------------------------------------------------------------------------

/** True when `actual` matches at least one `must_not_flag` expectation. Used
 *  to deny `must_find` credit to a finding that also violates a negative
 *  expectation at the same location (AC 42-43): `must_not_flag` wins. */
function violatesAnyMustNotFlag(
  actual: EvalActualFinding,
  mustNotFlag: EvalExpectation[],
): boolean {
  return mustNotFlag.some((expectation) => matchesExpectation(expectation, actual));
}

function splitByDirection(expectations: EvalExpectation[]): {
  mustFind: EvalExpectation[];
  mustNotFlag: EvalExpectation[];
} {
  const mustFind = expectations.filter((e) => e.expect === 'must_find');
  const mustNotFlag = expectations.filter((e) => e.expect === 'must_not_flag');
  return { mustFind, mustNotFlag };
}

// ---------------------------------------------------------------------------
// recall (AC 38-39, precedence AC 43)
// ---------------------------------------------------------------------------

/**
 * `recall` = matched `must_find` expectations / total `must_find`
 * expectations (AC 38). A case with zero `must_find` expectations reports
 * `recall = 1` (AC 39). A finding that also matches a `must_not_flag`
 * expectation is denied credit toward the `must_find` expectation it would
 * otherwise have matched (AC 43) — it does not disqualify the *expectation*
 * from being matched by some *other*, non-violating finding.
 */
export function computeRecall(
  expectations: EvalExpectation[],
  actuals: EvalActualFinding[],
): number {
  const { mustFind, mustNotFlag } = splitByDirection(expectations);
  if (mustFind.length === 0) return 1;

  const matchedCount = mustFind.filter((expectation) =>
    actuals.some(
      (actual) =>
        matchesExpectation(expectation, actual) && !violatesAnyMustNotFlag(actual, mustNotFlag),
    ),
  ).length;

  return matchedCount / mustFind.length;
}

// ---------------------------------------------------------------------------
// precision (AC 40-41, precedence AC 42)
// ---------------------------------------------------------------------------

/**
 * `precision` = actual findings matching at least one `must_find`
 * expectation / total actual findings (AC 40). A case that produced zero
 * actual findings reports `precision = 1` (AC 41). A finding matching both a
 * `must_find` and a `must_not_flag` expectation counts as matching the
 * `must_not_flag` one only (AC 42) — it is excluded from the numerator, so
 * it counts *against* precision rather than for it.
 */
export function computePrecision(
  expectations: EvalExpectation[],
  actuals: EvalActualFinding[],
): number {
  const { mustFind, mustNotFlag } = splitByDirection(expectations);
  if (actuals.length === 0) return 1;

  const matchingCount = actuals.filter(
    (actual) =>
      mustFind.some((expectation) => matchesExpectation(expectation, actual)) &&
      !violatesAnyMustNotFlag(actual, mustNotFlag),
  ).length;

  return matchingCount / actuals.length;
}

// ---------------------------------------------------------------------------
// citation_accuracy (AC 44-45)
// ---------------------------------------------------------------------------

/**
 * `citation_accuracy` = findings kept by the grounding gate / findings the
 * model produced before that gate (AC 44), i.e. `kept / (kept + dropped)`.
 * Zero pre-gate findings reports `citation_accuracy = 1` (AC 45) — there was
 * nothing to ground, so nothing was mis-grounded either. Takes the raw
 * counts, never a `ReviewOutcome` — see the file-level doc comment.
 */
export function computeCitationAccuracy(keptCount: number, droppedCount: number): number {
  const total = keptCount + droppedCount;
  if (total === 0) return 1;
  return keptCount / total;
}

// ---------------------------------------------------------------------------
// pass (AC 46)
// ---------------------------------------------------------------------------

/**
 * A case passes only when every `must_find` expectation matched AND no
 * actual finding matched any `must_not_flag` expectation (AC 46). The first
 * half reuses the same non-violating-match rule `computeRecall` does
 * (AC 43); the second half is a direct check independent of `computePrecision`
 * (a case can fail on a `must_not_flag` violation even with zero `must_find`
 * expectations, i.e. an all-`[]`-expected case that still produced findings).
 */
export function computePass(expectations: EvalExpectation[], actuals: EvalActualFinding[]): boolean {
  const { mustFind, mustNotFlag } = splitByDirection(expectations);

  const allMustFindMatched = mustFind.every((expectation) =>
    actuals.some(
      (actual) =>
        matchesExpectation(expectation, actual) && !violatesAnyMustNotFlag(actual, mustNotFlag),
    ),
  );
  const anyMustNotFlagViolated = actuals.some((actual) =>
    violatesAnyMustNotFlag(actual, mustNotFlag),
  );

  return allMustFindMatched && !anyMustNotFlagViolated;
}

// ---------------------------------------------------------------------------
// scoreEvalCase — convenience aggregator for the runner (Step 4)
// ---------------------------------------------------------------------------

export interface EvalCaseScore {
  recall: number;
  precision: number;
  citation_accuracy: number;
  pass: boolean;
}

/**
 * Computes all four scoring metrics for one case in a single call. `kept`/
 * `dropped` are the runner's pre-gate/post-gate counts (see the file-level
 * doc comment) — this function never touches a `ReviewOutcome` directly.
 */
export function scoreEvalCase(
  expectations: EvalExpectation[],
  actuals: EvalActualFinding[],
  grounding: { kept: number; dropped: number },
): EvalCaseScore {
  return {
    recall: computeRecall(expectations, actuals),
    precision: computePrecision(expectations, actuals),
    citation_accuracy: computeCitationAccuracy(grounding.kept, grounding.dropped),
    pass: computePass(expectations, actuals),
  };
}

// ---------------------------------------------------------------------------
// Deterministic case-name derivation (AC 13)
// ---------------------------------------------------------------------------

/** Lowercase, hyphenate, strip anything not alphanumeric/hyphen, collapse
 *  runs, trim leading/trailing hyphens. Pure and deterministic — same input
 *  string always yields the same slug. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Derives an eval case's `name` deterministically from a finding's title
 * and `file:start_line` (AC 13), so the same finding always yields the same
 * name — the property `(owner_id, name)` uniqueness (AC 7) and the
 * idempotent-repeat-click behavior (AC 14) both depend on. The title slug is
 * capped at `EVAL_CASE_NAME_SLUG_MAX_LENGTH` and the whole result at
 * `@devdigest/shared`'s `MAX_EVAL_CASE_NAME_LENGTH` so a long finding title
 * can't silently violate the contract's own `.max()` — the `file:start_line`
 * suffix is what actually disambiguates two same-titled findings, so it is
 * never the part that gets truncated under normal-length paths.
 */
export function deriveEvalCaseName(title: string, file: string, startLine: number): string {
  const suffix = `__${file}:${startLine}`;
  const slug = slugify(title).slice(0, EVAL_CASE_NAME_SLUG_MAX_LENGTH) || 'finding';
  return `${slug}${suffix}`;
}
