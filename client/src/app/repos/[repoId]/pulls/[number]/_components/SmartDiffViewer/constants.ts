import type { SmartDiffRole } from "@devdigest/shared";

/** Deterministic render order for SmartDiff groups (core -> wiring ->
 *  boilerplate, `docs/plans/smart-diff.md` §2). The server already returns
 *  groups in this order, but we re-apply it here defensively so the UI never
 *  silently depends on API array order. */
export const GROUP_ORDER: SmartDiffRole[] = ["core", "wiring", "boilerplate"];
