/** Parse an evidence line range ("12-31" or "12") into vcsBlobUrl's start/end. */
export function parseLineRange(range: string): { start?: number; end?: number } {
  const [startStr, endStr] = range.split("-");
  const start = startStr ? Number(startStr) : undefined;
  const end = endStr ? Number(endStr) : start;
  return { start: Number.isFinite(start) ? start : undefined, end: Number.isFinite(end) ? end : undefined };
}
