/** Relative "Xh ago" / "Xm ago" / "just now" for the "generated …" header
 *  meta — same "last refreshed" need as ConventionsListView/helpers.ts's
 *  copy, kept local per frontend-architecture (promote on a SECOND,
 *  UNRELATED need, not this one). */
export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** DOM id for a section's rail anchor / scroll target. */
export function sectionAnchorId(kind: string): string {
  return `onboarding-section-${kind}`;
}
