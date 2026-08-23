import type {
  Agent,
  ConventionCandidate,
  ConventionsState,
  Finding,
  FindingRecord,
  PrMeta,
  Repo,
  ReviewRecord,
  RunSummary,
} from '@devdigest/shared';

/**
 * Fully-specified `@devdigest/shared` fixtures shared by the infra
 * (`src/http/client.test.ts`), service (`src/service/*.test.ts`), and
 * presentation (`src/tools/*.test.ts`) suites (Step 7 of
 * `specs/mcp-server-plan.md`). Every field is present with a schema-valid
 * default so the same object satisfies a Zod schema's Output shape (used to
 * assert HTTP-client parsing) AND doubles as an already-resolved domain
 * object for service-layer mocks — override only what a given test cares
 * about.
 */

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Reviewer',
    description: 'A reviewer agent',
    provider: 'openai',
    model: 'gpt-4o',
    system_prompt: 'Review this PR for bugs and security issues.',
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    ...overrides,
  };
}

export function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    workspace_id: 'ws-1',
    owner: 'acme',
    name: 'widgets',
    full_name: 'acme/widgets',
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
    provider: 'github',
    host: 'github.com',
    insecure_tls: false,
    ...overrides,
  };
}

export function makePr(overrides: Partial<PrMeta> = {}): PrMeta {
  return {
    id: 'pr-1',
    number: 42,
    title: 'Add feature',
    author: 'octocat',
    branch: 'feature',
    base: 'main',
    head_sha: 'abc123',
    additions: 10,
    deletions: 2,
    files_count: 1,
    status: 'open',
    opened_at: null,
    updated_at: null,
    score: null,
    cost_usd: null,
    findings: null,
    ...overrides,
  };
}

export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'finding-1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Possible bug',
    file: 'src/foo.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'This looks wrong.',
    suggestion: null,
    confidence: 0.8,
    kind: 'finding',
    trifecta_components: null,
    evidence: null,
    ...overrides,
  };
}

/**
 * `ReviewRecord.findings` is `FindingRecord[]` (`Finding` + persisted-row
 * identity), not `Finding[]` — this fixture is what `makeReviewRecord`'s
 * `findings` field needs; `makeFinding` above stays a plain `Finding` for
 * anywhere only the raw LLM-output shape is needed.
 */
export function makeFindingRecord(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    ...makeFinding(),
    review_id: 'review-1',
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

export function makeReviewRecord(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'review-1',
    pr_id: 'pr-1',
    agent_id: 'agent-1',
    run_id: 'run-1',
    agent_name: 'Reviewer',
    kind: 'review',
    verdict: 'comment',
    summary: 'Looks fine.',
    score: 85,
    model: 'gpt-4o',
    grounding: null,
    created_at: '2026-08-01T00:00:00.000Z',
    findings: [],
    ...overrides,
  };
}

export function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Reviewer',
    provider: 'openai',
    model: 'gpt-4o',
    status: 'running',
    error: null,
    duration_ms: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    findings_count: null,
    grounding: null,
    ran_at: '2026-08-01T00:00:00.000Z',
    score: null,
    blockers: null,
    ...overrides,
  };
}

export function makeConventionCandidate(overrides: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: 'conv-1',
    category: 'naming',
    rule: 'Use camelCase for variables.',
    evidence_path: 'src/foo.ts',
    evidence_line_range: '12-31',
    evidence_snippet: 'const fooBar = 1;',
    confidence: 0.9,
    accepted: true,
    ...overrides,
  };
}

export function makeConventionsState(overrides: Partial<ConventionsState> = {}): ConventionsState {
  return {
    candidates: [],
    sample_file_count: 5,
    last_scan_at: '2026-08-01T00:00:00.000Z',
    scan_status: 'idle',
    ...overrides,
  };
}
