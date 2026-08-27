import type { EvalExpectationInput } from "@devdigest/shared";

/** Input tab strip order (AC 77). */
export const INPUT_TABS = ["diff", "files", "prMeta"] as const;
export type InputTab = (typeof INPUT_TABS)[number];

/** Inserted by the finding-skeleton helper (AC 75) — empty `file`/`start_line`
 *  so the author fills them in rather than the editor guessing. */
export const SKELETON_EXPECTATION: EvalExpectationInput = {
  expect: "must_find",
  file: "",
  start_line: 0,
};

export const JSON_INDENT = 2;
export const MODAL_WIDTH = 760;
