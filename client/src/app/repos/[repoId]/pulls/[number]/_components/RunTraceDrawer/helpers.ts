import type { LogLine } from "@devdigest/ui";
import type { RunTrace, SpecRead } from "@devdigest/shared";

interface RawEvent {
  t: string;
  kind: string;
  msg: string;
}

/** Map run-bus events to the LiveLogStream LogLine shape. */
export function eventsToLog(events: RawEvent[]): LogLine[] {
  return events.map((e) => ({ t: e.t, k: e.kind as LogLine["k"], m: e.msg }));
}

/** Map a persisted trace's log to the LiveLogStream LogLine shape. */
export function traceLog(trace: RunTrace | undefined): LogLine[] {
  return trace?.log.map((l) => ({ t: l.t, k: l.kind as LogLine["k"], m: l.msg })) ?? [];
}

/** Seconds-formatted duration. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}

/** Rough token estimate for a prompt block — same chars/4 heuristic the
 *  server's tokenizer adapter falls back to (server/src/adapters/tokenizer).
 *  Display-only: the real count is provider-tokenizer-specific and already
 *  shown in aggregate by trace.stats.tokens_in. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Sum of the server's REAL per-document token counts for the injected
 *  project-context set (`RunTrace.specs_read`) — unlike `approxTokens`, this
 *  is not a chars/4 estimate; the server already computed it via the
 *  Tokenizer adapter at read time. Returns `undefined` for an empty set so
 *  `PromptBlock` omits its token badge rather than showing "0 tok". */
export function specsReadTokenTotal(specsRead: SpecRead[]): number | undefined {
  if (specsRead.length === 0) return undefined;
  return specsRead.reduce((sum, sp) => sum + sp.tokens, 0);
}
