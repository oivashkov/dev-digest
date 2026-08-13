import type { ConventionCandidate } from "@devdigest/shared";

/** How many candidates in `list` currently have `accepted: true`. */
export function countAccepted(list: ConventionCandidate[]): number {
  return list.filter((c) => c.accepted).length;
}

/** Relative "Xh ago" / "Xm ago" / "just now" for the "last scan" subtitle. */
export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
