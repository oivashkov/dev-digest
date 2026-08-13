import { z } from 'zod';
import { FindingCategory } from './findings.js';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
});
export type Skill = z.infer<typeof Skill>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// A skill's usage numbers, always DERIVED (never stored) — see
// `SkillsService.getStats`/`list` for how each field is computed and the
// approximation it relies on (findings aren't attributed to a specific
// skill; a finding "counts" toward a skill when its category matches that
// skill type's mapped categories AND it came from a review by an agent this
// skill is attached to).
export const SkillStatsAgentUsage = z.object({
  id: z.string(),
  name: z.string(),
});
export type SkillStatsAgentUsage = z.infer<typeof SkillStatsAgentUsage>;

export const SkillFindingsByCategory = z.object({
  category: FindingCategory,
  count: z.number().int(),
});
export type SkillFindingsByCategory = z.infer<typeof SkillFindingsByCategory>;

export const SkillStats = z.object({
  used_by: z.number().int(),
  agents: z.array(SkillStatsAgentUsage),
  // null when no agent using this skill has any review yet — "no data", not "0%".
  pull_frequency_pct: z.number().min(0).max(100).nullable(),
  accept_rate_pct: z.number().min(0).max(100).nullable(),
  findings_30d: z.number().int(),
  findings_by_category: z.array(SkillFindingsByCategory),
});
export type SkillStats = z.infer<typeof SkillStats>;

// Skill + the three summary numbers from SkillStats, embedded on every row of
// `GET /skills` so a list/sidebar card can show "N agents · X% pull · Y%
// accept" without an N+1 round-trip from the client. `GET /skills/:id`
// returns the plain `Skill` — the summary is a list-view concern.
export const SkillSummary = Skill.extend({
  used_by: z.number().int(),
  pull_frequency_pct: z.number().min(0).max(100).nullable(),
  accept_rate_pct: z.number().min(0).max(100).nullable(),
});
export type SkillSummary = z.infer<typeof SkillSummary>;

// One immutable body snapshot, taken on every content-changing save (see
// `skill_versions` / `SkillsRepository.snapshotVersion`).
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  summary: z.string().nullable(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

// ---- Conventions ----
export const ConventionCategory = z.enum([
  'naming',
  'structure',
  'error_handling',
  'imports',
  'formatting',
  'testing',
  'other',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

export const ConventionCandidate = z.object({
  id: z.string(),
  category: ConventionCategory,
  rule: z.string(),
  evidence_path: z.string(),
  // "12-31" (range) or "12" (single line) — one string, mirrors the
  // `path:LINE-LINE` citation shown next to the code snippet in the UI.
  evidence_line_range: z.string(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  accepted: z.boolean(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

// GET /repos/:id/conventions
export const ConventionsState = z.object({
  candidates: z.array(ConventionCandidate),
  // Files actually sent to the extraction LLM call (not the full ranked set).
  sample_file_count: z.number().int(),
  last_scan_at: z.string().nullable(),
  scan_status: z.enum(['idle', 'scanning', 'failed']),
});
export type ConventionsState = z.infer<typeof ConventionsState>;

// POST /repos/:id/conventions/extract → 202
export const ConventionsExtractAccepted = z.object({
  status: z.literal('accepted'),
  job_id: z.string().nullish(),
  degraded: z.boolean().optional(),
});
export type ConventionsExtractAccepted = z.infer<typeof ConventionsExtractAccepted>;

// PATCH /conventions/:id — accept/reject and/or inline-edit in one call.
export const UpdateConventionCandidate = z.object({
  rule: z.string().min(1).optional(),
  evidence_snippet: z.string().min(1).optional(),
  accepted: z.boolean().optional(),
});
export type UpdateConventionCandidate = z.infer<typeof UpdateConventionCandidate>;

// ---- Agents ----
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a CI review should BLOCK (REQUEST_CHANGES + fail the
// check) vs just comment. Deterministic from severities; acted on ONLY in CI.
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;
