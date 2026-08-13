import type { ConventionCandidate } from "@devdigest/shared";

const MAX_SLUG_WORDS = 6;

/** Just the repo name (drop the owner) — "acme/payments-api" → "payments-api". */
export function repoSlug(repoFullName: string): string {
  const parts = repoFullName.split("/");
  return parts[parts.length - 1] || repoFullName;
}

/** A short kebab-case id for a rule's `##` section heading, e.g.
 *  "Always use async/await instead of .then() chains" → "always-use-async-await". */
export function slugifyRule(rule: string): string {
  const words = rule
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SLUG_WORDS);
  return words.join("-") || "convention";
}

/** Default skill name suggested from the repo — editable before save. */
export function defaultSkillName(repoFullName: string): string {
  return `${repoSlug(repoFullName)}-conventions`;
}

/**
 * Merge accepted candidates into a skill body: one `#` heading + one `##`
 * section per candidate (rule text + a "Detected in `path:range`:" code
 * citation) — matches the Create-skill-from-conventions mockup verbatim.
 */
export function mergeConventionsToMarkdown(repoFullName: string, candidates: ConventionCandidate[]): string {
  const heading = `# ${defaultSkillName(repoFullName)}\n\n`;
  const intro =
    `House conventions for \`${repoFullName}\`. Flag changes that violate any rule below ` +
    `and cite the offending \`file:line\`.\n\n`;
  const sections = candidates.map((c) => {
    const location = c.evidence_line_range ? `${c.evidence_path}:${c.evidence_line_range}` : c.evidence_path;
    return (
      `## ${slugifyRule(c.rule)}\n${c.rule}\n\n` +
      `Detected in \`${location}\`:\n\n` +
      "```\n" + c.evidence_snippet + "\n```\n"
    );
  });
  return heading + intro + sections.join("\n");
}

/** Rough token estimate (~4 chars/token) for the body's token-count readout. */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
