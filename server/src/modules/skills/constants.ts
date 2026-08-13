/** Constants for the skills module. */

/** Initial version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Default skill description when none is supplied on insert. */
export const DEFAULT_SKILL_DESCRIPTION = '';

/** Import upload size cap (decoded bytes) — keeps a bad/huge upload cheap to reject. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
