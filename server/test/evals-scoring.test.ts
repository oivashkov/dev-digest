/**
 * Pure scoring + deterministic case-name helpers (SPEC-04
 * `specs/04-eval-pipeline.md`, ACs 36-46 + AC 13). No `Container`, no DB —
 * every function under test takes plain data and returns plain data.
 *
 * Coverage goal (plan §7 Step 3): every AC 36-46 branch has a named
 * assertion, including the spec's own double-match precedence example
 * (`must_find` at `a.ts:10-20`, `must_not_flag` at `a.ts:18-25`, actual at
 * `a.ts:15-19` ⇒ fails) and all four degenerate `= 1` cases.
 */
import { describe, it, expect } from 'vitest';
import type { EvalExpectation } from '@devdigest/shared';
import {
  matchesExpectation,
  computeRecall,
  computePrecision,
  computeCitationAccuracy,
  computePass,
  scoreEvalCase,
  slugify,
  deriveEvalCaseName,
  type EvalActualFinding,
} from '../src/modules/evals/helpers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mustFind = (
  file: string,
  start_line: number,
  end_line?: number,
): EvalExpectation => ({ expect: 'must_find', file, start_line, end_line });

const mustNotFlag = (
  file: string,
  start_line: number,
  end_line?: number,
): EvalExpectation => ({ expect: 'must_not_flag', file, start_line, end_line });

const finding = (file: string, start_line: number, end_line: number): EvalActualFinding => ({
  file,
  start_line,
  end_line,
});

// ---------------------------------------------------------------------------
// matchesExpectation — AC 36-37
// ---------------------------------------------------------------------------

describe('matchesExpectation', () => {
  it('matches when file is equal and ranges intersect (AC 36)', () => {
    expect(matchesExpectation(mustFind('src/a.ts', 10, 20), finding('src/a.ts', 15, 19))).toBe(
      true,
    );
    // touching at a single line still intersects
    expect(matchesExpectation(mustFind('src/a.ts', 10, 20), finding('src/a.ts', 20, 25))).toBe(
      true,
    );
  });

  it('does not match on a different file even with intersecting lines (AC 36)', () => {
    expect(matchesExpectation(mustFind('src/a.ts', 10, 20), finding('src/b.ts', 10, 20))).toBe(
      false,
    );
  });

  it('does not match when ranges do not intersect', () => {
    expect(matchesExpectation(mustFind('src/a.ts', 10, 20), finding('src/a.ts', 21, 25))).toBe(
      false,
    );
  });

  it('treats a missing end_line as equal to start_line (AC 37)', () => {
    const expectation = mustFind('src/a.ts', 12); // no end_line
    expect(matchesExpectation(expectation, finding('src/a.ts', 12, 12))).toBe(true);
    expect(matchesExpectation(expectation, finding('src/a.ts', 11, 13))).toBe(true); // intersects
    expect(matchesExpectation(expectation, finding('src/a.ts', 13, 20))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeRecall — AC 38-39, precedence AC 43
// ---------------------------------------------------------------------------

describe('computeRecall', () => {
  it('computes matched must_find / total must_find (AC 38)', () => {
    const expectations = [mustFind('a.ts', 1, 5), mustFind('b.ts', 1, 5)];
    const actuals = [finding('a.ts', 2, 2)]; // matches only the first
    expect(computeRecall(expectations, actuals)).toBe(0.5);
  });

  it('reports recall = 1 when there are zero must_find expectations (AC 39, degenerate)', () => {
    // a pure must_not_flag case (the desired "zero findings" outcome) and a
    // fully empty case both have zero must_find expectations
    expect(computeRecall([mustNotFlag('a.ts', 1, 5)], [])).toBe(1);
    expect(computeRecall([], [])).toBe(1);
  });

  it('denies recall credit to a finding that also violates must_not_flag (AC 43, spec double-match example)', () => {
    const expectations = [mustFind('a.ts', 10, 20), mustNotFlag('a.ts', 18, 25)];
    const actuals = [finding('a.ts', 15, 19)]; // matches both
    expect(computeRecall(expectations, actuals)).toBe(0);
  });

  it('still credits a must_find expectation from a different, non-violating finding', () => {
    const expectations = [mustFind('a.ts', 10, 20), mustNotFlag('a.ts', 18, 25)];
    // one finding matches both (denied), a second finding matches must_find only
    const actuals = [finding('a.ts', 15, 19), finding('a.ts', 10, 12)];
    expect(computeRecall(expectations, actuals)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computePrecision — AC 40-41, precedence AC 42
// ---------------------------------------------------------------------------

describe('computePrecision', () => {
  it('computes findings matching a must_find / total findings (AC 40)', () => {
    const expectations = [mustFind('a.ts', 1, 5)];
    const actuals = [finding('a.ts', 2, 2), finding('b.ts', 2, 2)]; // one matches, one doesn't
    expect(computePrecision(expectations, actuals)).toBe(0.5);
  });

  it('reports precision = 1 when zero findings were produced (AC 41, degenerate)', () => {
    expect(computePrecision([mustFind('a.ts', 1, 5)], [])).toBe(1);
  });

  it('counts a double-matching finding against must_not_flag, not for precision (AC 42, spec example)', () => {
    const expectations = [mustFind('a.ts', 10, 20), mustNotFlag('a.ts', 18, 25)];
    const actuals = [finding('a.ts', 15, 19)]; // matches both
    // the one finding produced does NOT count toward the numerator
    expect(computePrecision(expectations, actuals)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeCitationAccuracy — AC 44-45
// ---------------------------------------------------------------------------

describe('computeCitationAccuracy', () => {
  it('computes kept / (kept + dropped) (AC 44)', () => {
    expect(computeCitationAccuracy(3, 1)).toBe(0.75);
  });

  it('reports citation_accuracy = 1 when the model produced zero findings before the gate (AC 45, degenerate)', () => {
    expect(computeCitationAccuracy(0, 0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computePass — AC 46 (+ the spec's degenerate/edge cases)
// ---------------------------------------------------------------------------

describe('computePass', () => {
  it('passes when every must_find matched and nothing violated must_not_flag (AC 46)', () => {
    const expectations = [mustFind('a.ts', 1, 5), mustNotFlag('b.ts', 1, 5)];
    const actuals = [finding('a.ts', 2, 2)];
    expect(computePass(expectations, actuals)).toBe(true);
  });

  it('passes the desired must_not_flag-only outcome: zero findings (edge case)', () => {
    expect(computePass([mustNotFlag('a.ts', 1, 5)], [])).toBe(true);
  });

  it('fails on the spec double-match precedence example (ACs 42-43, 46)', () => {
    const expectations = [mustFind('a.ts', 10, 20), mustNotFlag('a.ts', 18, 25)];
    const actuals = [finding('a.ts', 15, 19)];
    expect(computePass(expectations, actuals)).toBe(false);
  });

  it('fails when a must_not_flag expectation is violated even with no must_find expectations', () => {
    expect(computePass([mustNotFlag('a.ts', 1, 5)], [finding('a.ts', 2, 2)])).toBe(false);
  });

  it('fails when a must_find expectation is unmatched', () => {
    expect(computePass([mustFind('a.ts', 1, 5)], [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scoreEvalCase — aggregator
// ---------------------------------------------------------------------------

describe('scoreEvalCase', () => {
  it('combines all four metrics from expectations + actuals + grounding counts', () => {
    const expectations = [mustFind('a.ts', 1, 5)];
    const actuals = [finding('a.ts', 2, 2)];
    const score = scoreEvalCase(expectations, actuals, { kept: 1, dropped: 0 });
    expect(score).toEqual({
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      pass: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Deterministic case-name derivation — AC 13
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases, hyphenates, and strips punctuation deterministically', () => {
    expect(slugify('SQL Injection in login()!')).toBe('sql-injection-in-login');
    // same input twice yields the same output
    expect(slugify('SQL Injection in login()!')).toBe(slugify('SQL Injection in login()!'));
  });
});

describe('deriveEvalCaseName', () => {
  it('derives the same name from the same finding every time (AC 13)', () => {
    const name1 = deriveEvalCaseName('Missing input validation', 'src/config.ts', 12);
    const name2 = deriveEvalCaseName('Missing input validation', 'src/config.ts', 12);
    expect(name1).toBe(name2);
    expect(name1).toBe('missing-input-validation__src/config.ts:12');
  });

  it('yields different names for different findings (different file:line disambiguates same title)', () => {
    const nameA = deriveEvalCaseName('Missing input validation', 'src/config.ts', 12);
    const nameB = deriveEvalCaseName('Missing input validation', 'src/other.ts', 12);
    expect(nameA).not.toBe(nameB);
  });
});
