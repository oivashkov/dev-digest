import type { PrBlastRadius } from "@devdigest/shared";

/** True when there is nothing downstream to show for any changed symbol —
   no callers, no endpoints, no crons — regardless of index status. Drives
   `blast.noDownstream` instead of rendering a silently empty tree/graph. */
export function isBlastEmpty(data: Pick<PrBlastRadius, "counts">): boolean {
  const { callers, endpoints, crons } = data.counts;
  return callers === 0 && endpoints === 0 && crons === 0;
}

/** `PrBlastRadius.reason` values the client has copy for. Anything else
   (a server-side `BlastReason` this client build predates) falls back to
   `status.reason.unknown` instead of rendering a raw/missing i18n key. */
const KNOWN_REASONS = new Set([
  "flag_off",
  "index_failed",
  "index_partial",
  "repo_too_large",
  "no_data",
  "truncated",
]);

export function reasonKey(reason: string | null | undefined): string {
  return reason && KNOWN_REASONS.has(reason) ? reason : "unknown";
}
