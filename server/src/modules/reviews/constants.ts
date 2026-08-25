/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

// ---- Project Context injection (SPEC-01, Q8) -------------------------------
// Unvalidated against a real model's context window — chosen by analogy to
// the Intent Layer's MAX_PLAN_REFS/MAX_PLAN_EXCERPT_CHARS (intent.ts:32,36).
// One edit here revises both caps; also surfaced in the editor before the run.

/** Per-document truncation cap for an injected project-context document. */
export const MAX_CONTEXT_DOC_CHARS = 20_000;

/** Total character budget for the whole `## Project context` block, across
 *  every injected document combined. */
export const MAX_CONTEXT_TOTAL_CHARS = 60_000;
