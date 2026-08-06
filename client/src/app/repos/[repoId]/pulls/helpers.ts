import type { Finding } from "@/lib/types";
import { SEVERITY_ORDER, SIZE_MEDIUM_MAX, SIZE_SMALL_MAX, type PrMeta, type SizeInfo } from "./constants";

/** Bucket a PR into S/M/L by total changed lines. */
export function sizeOf(pr: PrMeta): SizeInfo {
  const lines = pr.additions + pr.deletions;
  const size = lines < SIZE_SMALL_MAX ? "S" : lines < SIZE_MEDIUM_MAX ? "M" : "L";
  return { size, lines };
}

export interface SeverityGroup {
  severity: (typeof SEVERITY_ORDER)[number];
  findings: Finding[];
}

/**
 * Bucket a PR's (already dismissed-excluded) findings by severity for the
 * FINDINGS column, worst-first, dropping empty severities entirely — a PR
 * with only suggestions shows a single icon, not three with two zeros.
 */
export function groupFindingsBySeverity(
  findings: Finding[] | null | undefined,
): SeverityGroup[] {
  if (!findings || findings.length === 0) return [];
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    findings: findings.filter((f) => f.severity === severity),
  })).filter((g) => g.findings.length > 0);
}

/** Compact relative time for the list's UPDATED column (e.g. "3h", "2d"). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
