import { unzipSync } from 'fflate';
import type {
  FindingCategory,
  Skill,
  SkillSource,
  SkillStats,
  SkillStatsAgentUsage,
  SkillType,
} from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import type { SkillRow } from './repository.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping, the
 * content-version-bump rule, import extraction, and the stats aggregation
 * math. No I/O beyond decoding the buffer already handed to it; never
 * executes anything from an archive.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/** Fields whose change bumps the skill's version (anything but `enabled`). */
export interface SkillContentPatch {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
}

/**
 * True when a patch changes content (vs. just toggling `enabled`) relative to
 * the existing row — a content change bumps the version and snapshots
 * skill_versions.
 */
export function isSkillContentChange(
  existing: Pick<SkillRow, 'name' | 'description' | 'type' | 'body'>,
  patch: SkillContentPatch,
): boolean {
  return (
    (patch.name !== undefined && patch.name !== existing.name) ||
    (patch.description !== undefined && patch.description !== existing.description) ||
    (patch.type !== undefined && patch.type !== existing.type) ||
    (patch.body !== undefined && patch.body !== existing.body)
  );
}

/**
 * Human-readable changelog line for a `skill_versions` snapshot, e.g.
 * "Updated body, type" — named after whichever fields actually changed
 * (never guesses at *why*). Only called when `isSkillContentChange` is true,
 * so at least one field always changed.
 */
export function summarizeSkillChange(
  existing: Pick<SkillRow, 'name' | 'description' | 'type' | 'body'>,
  patch: SkillContentPatch,
): string {
  const changed: string[] = [];
  if (patch.name !== undefined && patch.name !== existing.name) changed.push('name');
  if (patch.description !== undefined && patch.description !== existing.description)
    changed.push('description');
  if (patch.type !== undefined && patch.type !== existing.type) changed.push('type');
  if (patch.body !== undefined && patch.body !== existing.body) changed.push('body');
  return changed.length > 0 ? `Updated ${changed.join(', ')}` : 'Updated skill';
}

// ---- Stats ------------------------------------------------------------
//
// Findings aren't attributed to a specific skill anywhere in the schema —
// only to the review (and, through it, the agent) that produced them. So
// "this skill's stats" is necessarily an APPROXIMATION: a finding counts
// toward a skill when (a) it came from a review by an agent this skill is
// currently attached to, AND (b) its category falls in that skill TYPE's
// mapped categories below. A `rubric`/`custom` skill (no single semantic
// category) matches every finding from those agents; `security`/`convention`
// narrow to the one category they're about. See SkillStats' doc comment in
// @devdigest/shared for the same caveat surfaced to API consumers.
export const SKILL_TYPE_FINDING_CATEGORIES: Record<SkillType, FindingCategory[] | 'all'> = {
  rubric: 'all',
  custom: 'all',
  security: ['security'],
  convention: ['style'],
};

function matchesSkillType(type: SkillType, category: string): boolean {
  const categories = SKILL_TYPE_FINDING_CATEGORIES[type];
  return categories === 'all' || categories.includes(category as FindingCategory);
}

/** Raw review row needed for stats — just enough to compute pull frequency. */
export interface SkillStatsReviewRow {
  id: string;
  createdAt: Date;
}

/** Raw finding row needed for stats, with its parent review's createdAt
 *  already joined in (avoids a second round trip per finding). */
export interface SkillStatsFindingRow {
  reviewId: string;
  category: string;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
  reviewCreatedAt: Date;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function roundPct(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Compute a skill's usage stats from raw rows. Pure — the repository does the
 * fetching, this does the math, so the approximation above is unit-testable
 * without a database.
 */
export function computeSkillStats(
  type: SkillType,
  agents: SkillStatsAgentUsage[],
  reviews: SkillStatsReviewRow[],
  findings: SkillStatsFindingRow[],
  now: Date = new Date(),
): SkillStats {
  const matching = findings.filter((f) => matchesSkillType(type, f.category));

  const matchingReviewIds = new Set(matching.map((f) => f.reviewId));
  const pullFrequencyPct =
    reviews.length > 0 ? roundPct((matchingReviewIds.size / reviews.length) * 100) : null;

  const actioned = matching.filter((f) => f.acceptedAt || f.dismissedAt);
  const accepted = actioned.filter((f) => f.acceptedAt);
  const acceptRatePct = actioned.length > 0 ? roundPct((accepted.length / actioned.length) * 100) : null;

  const cutoff = now.getTime() - THIRTY_DAYS_MS;
  const recent = matching.filter((f) => f.reviewCreatedAt.getTime() >= cutoff);

  const byCategory = new Map<string, number>();
  for (const f of recent) byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);

  return {
    used_by: agents.length,
    agents,
    pull_frequency_pct: pullFrequencyPct,
    accept_rate_pct: acceptRatePct,
    findings_30d: recent.length,
    findings_by_category: Array.from(byCategory.entries()).map(([category, count]) => ({
      category: category as FindingCategory,
      count,
    })),
  };
}

// ---- Import extraction ----------------------------------------------------

/** Entries kept from an archive; everything else is discarded, never read. */
const TEXT_EXTENSIONS = ['.md', '.txt'];

export interface ExtractedSkillCore {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  evidence_files: string[];
}

function stripExtension(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  return base.replace(/\.[^./\\]+$/, '');
}

/** Guess a skill name from the first markdown `# Heading`, else the filename. */
function guessName(content: string, fallback: string): string {
  const heading = content.match(/^#\s+(.+)$/m);
  return heading ? heading[1]!.trim() : fallback;
}

/**
 * Extract a skill's core (name/body/evidence) from an uploaded file.
 * `.md`/`.txt` → the whole content is the body. `.zip` → only text-like
 * entries are decompressed and read; every other entry (scripts, binaries) is
 * left as untouched, discarded bytes — nothing from an archive is ever
 * executed. Returns a preview; the caller decides whether to persist it.
 */
export function extractSkillCore(filename: string, content: Buffer): ExtractedSkillCore {
  if (filename.toLowerCase().endsWith('.zip')) return extractFromZip(filename, content);

  const text = content.toString('utf8');
  return {
    name: guessName(text, stripExtension(filename)),
    description: '',
    type: 'custom',
    source: 'extracted',
    body: text,
    evidence_files: [filename],
  };
}

function extractFromZip(filename: string, content: Buffer): ExtractedSkillCore {
  const entries = unzipSync(new Uint8Array(content), {
    // Only decompress text-like entries. Every other entry (scripts,
    // binaries, executables) is skipped entirely — never decompressed, never
    // read, never executed.
    filter: (file) => TEXT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext)),
  });
  const names = Object.keys(entries).sort();
  if (names.length === 0) {
    throw new ValidationError('Archive has no markdown/text entries to import');
  }

  const decoder = new TextDecoder('utf-8');
  const preferred = names.find((n) => /(^|\/)(skill|readme)\.md$/i.test(n));
  const body = preferred
    ? decoder.decode(entries[preferred])
    : names.map((n) => decoder.decode(entries[n]!)).join('\n\n---\n\n');

  return {
    name: guessName(preferred ? decoder.decode(entries[preferred]!) : body, stripExtension(filename)),
    description: '',
    type: 'custom',
    source: 'extracted',
    body,
    evidence_files: names,
  };
}
