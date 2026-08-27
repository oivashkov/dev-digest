/**
 * Demo fixture #3 (lab06 walkthrough) — deliberately BORDERLINE, unlike the
 * other two fixtures in this folder (which have an unambiguous bug). This
 * one is genuinely debatable: reasonable reviewers could call the missing
 * large-number test either "a real gap" or "out of scope for this PR" —
 * that judgment call is the point. It exists to show the eval trend moving
 * from natural model-to-model variance, not from a prompt change.
 *
 * Isolated, unimported — same zero-blast-radius rule as the other fixtures
 * in this folder. Safe to delete once the walkthrough is recorded.
 */

/** Formats a number of cents as a "$X.YZ" string. Negative amounts are
 *  shown with a leading "-", e.g. formatCents(-150) === "-$1.50". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars}.${remainder.toString().padStart(2, "0")}`;
}
