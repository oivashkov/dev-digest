/** Constants for the conventions module. */

/** Job kind registered on the JobRunner for a repo's convention extraction. */
export const CONVENTIONS_EXTRACT_JOB_KIND = 'conventions-extract';

/** Files actually sent to the extraction LLM call (ranked, junk-filtered — see repoIntel.getConventionSamples). */
export const SAMPLE_FILE_COUNT = 30;

/** schemaName passed to completeStructured — also what the mock LLM adapter keys `structuredBySchema` fixtures by. */
export const CONVENTION_EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';

/** Per-file truncation before prompting — keeps the cheap-model context budget bounded. */
export const MAX_FILE_CHARS = 4000;

export const CONVENTION_CATEGORIES = [
  'naming',
  'structure',
  'error_handling',
  'imports',
  'formatting',
  'testing',
  'other',
] as const;
