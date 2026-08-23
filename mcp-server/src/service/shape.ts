import type { Agent, ConventionCandidate, Finding } from '@devdigest/shared';
import type { AgentSummary, ConventionSummary, FindingSummary } from './results.js';

/**
 * Pure trim + pagination helpers shared by every read method (`listAgents`,
 * `getConventions`, `getFindings`) and `runAgentOnPr`'s completed-review
 * shaping in `index.ts`. No I/O, no `@devdigest/shared` schema re-declaration
 * — these only narrow an already-validated object to the concise shape the
 * plan's tool contracts (§5 Step 4) specify (practice #3: concise structured
 * response, never the raw upstream record).
 */

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Clamps/normalizes possibly-undefined or out-of-range page/pageSize inputs before slicing. */
export function paginate<T>(items: T[], page?: number, pageSize?: number): Paginated<T> {
  const safePage = Number.isFinite(page) && (page as number) >= 1 ? Math.floor(page as number) : DEFAULT_PAGE;
  const safePageSize =
    Number.isFinite(pageSize) && (pageSize as number) >= 1
      ? Math.min(Math.floor(pageSize as number), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  const total = items.length;
  const start = (safePage - 1) * safePageSize;
  return {
    items: items.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    total,
  };
}

/**
 * `agent.provider` (the backing LLM vendor — `openai`/`anthropic`/
 * `openrouter`) is deliberately dropped here — it's an internal
 * implementation detail, not something a calling agent needs to pick or
 * identify an agent by (that's `id`/`name`); see `mcp-server/INSIGHTS.md`.
 */
export function trimAgent(agent: Agent): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    model: agent.model,
    enabled: agent.enabled,
    strategy: agent.strategy,
  };
}

export function trimConvention(candidate: ConventionCandidate): ConventionSummary {
  return {
    category: candidate.category,
    rule: candidate.rule,
    evidence: `${candidate.evidence_path}:${candidate.evidence_line_range}`,
    confidence: candidate.confidence,
    accepted: candidate.accepted,
  };
}

/**
 * `Finding.start_line` becomes the single `line` field — the plan's
 * `get_findings`/`run_agent_on_pr` tool contracts (§5 Step 4) specify one
 * `line`, not a `start_line`/`end_line` pair; `start_line` is the citation
 * anchor a reader jumps to first.
 */
export function trimFinding(finding: Finding): FindingSummary {
  return {
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    file: finding.file,
    line: finding.start_line,
    rationale: finding.rationale,
    ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
  };
}
