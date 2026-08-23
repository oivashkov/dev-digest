import type { OnboardingSectionKind } from '@devdigest/shared';

/** Constants for the onboarding module. */

/** Job kind registered on the JobRunner for a repo's onboarding-tour generation. */
export const ONBOARDING_GENERATE_JOB_KIND = 'onboarding-generate';

/** schemaName passed to completeStructured — also what the mock LLM adapter
 *  keys `structuredBySchema` fixtures by. */
export const ONBOARDING_SCHEMA_NAME = 'OnboardingTour';

/** The five canonical sections, fixed for v1 (SPEC-02 Q1/Q3) — server
 *  constant rendered into the prompt's `{{sections}}` placeholder, in
 *  persisted order. */
export const ONBOARDING_SECTIONS: { kind: OnboardingSectionKind; title: string }[] = [
  { kind: 'architecture', title: 'Architecture overview' },
  { kind: 'critical_paths', title: 'Critical paths' },
  { kind: 'local_setup', title: 'How to run locally' },
  { kind: 'reading_path', title: 'Guided reading path' },
  { kind: 'first_tasks', title: 'First tasks' },
];

/** Token budget passed to `repoIntel.getRepoMap` (Q12 — reuse the existing
 *  budgeting mechanism; this number is an implementation-time tuning
 *  decision, not a spec commitment). */
export const REPO_MAP_TOKEN_BUDGET = 6000;

/** How many top-ranked files to feed as the "ranked files" fact block. */
export const TOP_FILES_N = 20;

/** Persisted link cap per section (structural AC — a truncation, not a
 *  rejection, so it lives in the generation schema's normalization pass,
 *  not the strict persistence schema). */
export const MAX_LINKS_PER_SECTION = 4;

/** Per-manifest-file truncation before prompting. */
export const MAX_MANIFEST_CHARS = 4000;

/** Manifest/compose/env-example files fed as facts for the `local_setup`
 *  section (Q8) — these are NOT in `file_rank` (the walker only indexes
 *  `SUPPORTED_EXT` source files), so their paths are unioned into the
 *  link-validation allowlist separately from `getFileRank` hits. */
export const MANIFEST_PATHS = ['package.json', 'docker-compose.yml', '.env.example'];
