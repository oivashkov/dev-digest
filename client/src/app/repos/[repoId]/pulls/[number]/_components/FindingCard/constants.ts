/** Constants for FindingCard. */

/** Severity → CSS colour token. */
export const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
  INFO: "var(--info)",
};

/** Fallback colour for an unknown severity. */
export const SEV_COLOR_FALLBACK = "var(--text-muted)";

/* "Turn into eval case" (SPEC-04 ACs 8-18) tooltip copy. Not run through
   next-intl: `messages/en/prReview.json` is owned by a sibling plan step
   (Step 7, already landed) that added exactly one key here
   (`finding.turnIntoEvalCase`, the button's own label) and no others — these
   `title` attributes follow the same untranslated-attribute precedent
   already in this codebase (e.g. `ReviewRunAccordion.tsx`'s
   `title="Delete this review run"`, `AgentCard.tsx`'s
   `aria-label="Delete agent"`), not a gap to silently fill by editing a file
   outside this component's owned paths. */
export const TURN_INTO_EVAL_CASE_DISABLED_TITLE =
  "Accept or dismiss this finding first to turn it into an eval case.";
export const TURN_INTO_EVAL_CASE_DONE_TITLE = "Eval case created.";
export const TURN_INTO_EVAL_CASE_ERROR_FALLBACK = "Couldn't create the eval case.";
