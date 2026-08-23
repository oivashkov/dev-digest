import type { SpecFile } from "@devdigest/shared";

/** Relative "Xh ago" / "Xm ago" / "just now" for the "last scanned" footer. */
export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Case-insensitive path-substring filter, matching the Context tab's own
 *  filter rule (SPEC-01: "documents whose path contains the typed text"). */
export function filterDocuments(documents: SpecFile[], query: string): SpecFile[] {
  const q = query.trim().toLowerCase();
  if (!q) return documents;
  return documents.filter((d) => d.path.toLowerCase().includes(q));
}

const TYPE_COLORS: Record<SpecFile["type"], { color: string; bg: string }> = {
  specs: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  docs: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
  insights: { color: "var(--ok)", bg: "var(--ok-bg)" },
};

export function typeBadgeStyle(type: SpecFile["type"]): { color: string; bg: string } {
  return TYPE_COLORS[type];
}
