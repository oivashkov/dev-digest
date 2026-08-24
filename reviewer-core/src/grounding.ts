import type { Finding, ReviewFocusItem, Risk, RiskBriefExtraction, UnifiedDiff } from '@devdigest/shared';

/**
 * Citation grounding — the mandatory mechanical gate for diff-findings.
 *
 * A diff-finding is kept ONLY if its [start_line, end_line] range intersects a
 * real hunk in the unified diff for the same file. Findings that fail are
 * dropped (the model "hallucinated" a location).
 *
 * EXCEPTION: findings from full-file scanners (hooks / blast / onboarding) are
 * not tied to a diff hunk — they ground against the file existing in the diff
 * (or are exempted entirely). We treat `kind` in {secret_leak, lethal_trifecta,
 * phantom, hook} as full-file: they only require the file to be present.
 */

const FULL_FILE_KINDS = new Set(['secret_leak', 'lethal_trifecta', 'phantom', 'hook']);

export interface GroundingResult {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
}

/** Build a quick lookup of file → set of new-side line numbers covered by hunks. */
export function buildLineIndex(diff: UnifiedDiff): Map<string, Set<number>> {
  const idx = new Map<string, Set<number>>();
  for (const f of diff.files) {
    const set = new Set<number>();
    for (const h of f.hunks) {
      if (h.newLineNumbers && h.newLineNumbers.length > 0) {
        for (const n of h.newLineNumbers) set.add(n);
      } else {
        // fall back to the hunk's declared new range
        for (let n = h.newStart; n < h.newStart + Math.max(h.newLines, 1); n++) set.add(n);
      }
    }
    idx.set(f.path, set);
  }
  return idx;
}

function rangeIntersects(lines: Set<number>, start: number, end: number): boolean {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  for (let n = lo; n <= hi; n++) if (lines.has(n)) return true;
  return false;
}

/**
 * Apply the grounding gate to a set of findings against a unified diff.
 * Returns the kept findings and the dropped ones with reasons (for the trace).
 */
export function groundFindings(findings: Finding[], diff: UnifiedDiff): GroundingResult {
  const lineIndex = buildLineIndex(diff);
  const filesInDiff = new Set(diff.files.map((f) => f.path));
  const kept: Finding[] = [];
  const dropped: { finding: Finding; reason: string }[] = [];

  for (const finding of findings) {
    const isFullFile = finding.kind ? FULL_FILE_KINDS.has(finding.kind) : false;

    if (!filesInDiff.has(finding.file)) {
      dropped.push({ finding, reason: `file '${finding.file}' not present in diff` });
      continue;
    }

    if (isFullFile) {
      // full-file scanners only need the file to be in the diff
      kept.push(finding);
      continue;
    }

    const lines = lineIndex.get(finding.file) ?? new Set<number>();
    if (rangeIntersects(lines, finding.start_line, finding.end_line)) {
      kept.push(finding);
    } else {
      dropped.push({
        finding,
        reason: `lines ${finding.start_line}-${finding.end_line} do not intersect any diff hunk in '${finding.file}'`,
      });
    }
  }

  return { kept, dropped };
}

/** Human-readable summary, e.g. "3/3 passed" used in run-trace stats. */
export function groundingSummary(result: GroundingResult): string {
  const total = result.kept.length + result.dropped.length;
  return `${result.kept.length}/${total} passed`;
}

/**
 * Citation grounding — the mandatory mechanical gate for the risk-brief call
 * (`extractRiskBrief` in `./review/risk-brief.ts`).
 *
 * A `Risk` is kept only if every one of its `file_refs` is in the allowlisted
 * file set. A `ReviewFocusItem` is kept only if its `file` is in the
 * allowlisted file set AND, when it cites an `endpoint`, that endpoint is in
 * the allowlisted endpoint set. Anything that fails is dropped whole
 * (drop-not-reject, same semantics as `groundFindings` — the model
 * "hallucinated" a location or endpoint). Never throws: a caller with an
 * empty allowlist, or an extraction that cites nothing real, gets back
 * `{ risks: [], review_focus: [] }` (AC13).
 *
 * Deliberately a separate function from `groundFindings` (different input
 * shape, different citation kind) rather than a generic-ized merge — keeps
 * `groundFindings`'s and `groundingSummary`'s existing signatures untouched,
 * since `groundingSummary` already feeds run-trace stats consumed elsewhere.
 */

export interface RiskBriefAllowlist {
  files: Set<string> | string[];
  endpoints: Set<string> | string[];
}

export interface RiskBriefGroundingDrop {
  kind: 'risk' | 'review_focus';
  item: Risk | ReviewFocusItem;
  reason: string;
}

export interface RiskBriefGroundingResult {
  risks: Risk[];
  review_focus: ReviewFocusItem[];
  dropped: RiskBriefGroundingDrop[];
}

function toSet(value: Set<string> | string[]): Set<string> {
  return value instanceof Set ? value : new Set(value);
}

/** Apply the grounding gate to a risk-brief extraction against an allowlist. */
export function groundRiskBrief(
  extraction: RiskBriefExtraction,
  allowlist: RiskBriefAllowlist,
): RiskBriefGroundingResult {
  const files = toSet(allowlist.files);
  const endpoints = toSet(allowlist.endpoints);

  const risks: Risk[] = [];
  const review_focus: ReviewFocusItem[] = [];
  const dropped: RiskBriefGroundingDrop[] = [];

  for (const risk of extraction.risks) {
    const badRef = risk.file_refs.find((f) => !files.has(f));
    if (badRef !== undefined) {
      dropped.push({
        kind: 'risk',
        item: risk,
        reason: `file_refs entry '${badRef}' is not a changed file in this PR`,
      });
      continue;
    }
    risks.push(risk);
  }

  for (const item of extraction.review_focus) {
    if (!files.has(item.file)) {
      dropped.push({
        kind: 'review_focus',
        item,
        reason: `file '${item.file}' is not a changed file in this PR`,
      });
      continue;
    }
    if (item.endpoint != null && !endpoints.has(item.endpoint)) {
      dropped.push({
        kind: 'review_focus',
        item,
        reason: `endpoint '${item.endpoint}' is not an impacted endpoint/cron for this PR`,
      });
      continue;
    }
    review_focus.push(item);
  }

  return { risks, review_focus, dropped };
}

/** Human-readable summary, e.g. "3/4 passed" for `groundRiskBrief`'s result. */
export function riskBriefGroundingSummary(result: RiskBriefGroundingResult): string {
  const kept = result.risks.length + result.review_focus.length;
  const total = kept + result.dropped.length;
  return `${kept}/${total} passed`;
}
