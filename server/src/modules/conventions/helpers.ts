import type { ConventionCandidate, ConventionCategory } from '@devdigest/shared';
import type { ConventionRow } from './repository.js';

/** Map a persisted convention row to the public `ConventionCandidate` DTO. */
export function toConventionCandidateDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    category: row.category as ConventionCategory,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_line_range: row.evidenceLineRange ?? '',
    snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    accepted: row.accepted,
  };
}
