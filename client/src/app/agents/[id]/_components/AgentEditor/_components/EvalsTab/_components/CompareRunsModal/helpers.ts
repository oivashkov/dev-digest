/* CompareRunsModal/helpers.ts — signed-delta formatting + a local line diff
   for the system-prompt panel (AC 50). Deliberately a local copy of the same
   small LCS diff `SkillEditor/_components/VersionsTab/helpers.ts` already
   has, rather than a shared `src/lib` export — that file's own precedent is
   two independent per-editor copies, not a promoted shared one (also outside
   this step's Owned paths regardless). */

export interface DiffLine {
  type: "same" | "add" | "remove";
  text: string;
}

/** `a` is the older/"left" text, `b` the newer/"right" one. */
export function diffLines(a: string, b: string): DiffLine[] {
  const linesA = a === "" ? [] : a.split("\n");
  const linesB = b === "" ? [] : b.split("\n");
  const n = linesA.length;
  const m = linesB.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = linesA[i] === linesB[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (linesA[i] === linesB[j]) {
      result.push({ type: "same", text: linesA[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      result.push({ type: "remove", text: linesA[i]! });
      i++;
    } else {
      result.push({ type: "add", text: linesB[j]! });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: "remove", text: linesA[i]! });
    i++;
  }
  while (j < m) {
    result.push({ type: "add", text: linesB[j]! });
    j++;
  }
  return result;
}

/** Signed percentage-point delta, e.g. "+5pp" / "-12pp" / "0pp" — `a`/`b` are
 *  0..1 fractions (recall/precision/citation_accuracy). */
export function signedPctDelta(a: number, b: number): string {
  const pp = Math.round((b - a) * 100);
  return pp > 0 ? `+${pp}pp` : `${pp}pp`;
}

/** Signed USD delta, or "—" when either side has no cost recorded. */
export function signedCostDelta(a: number | null, b: number | null): string {
  if (a == null || b == null) return "—";
  const d = b - a;
  const abs = Math.abs(d).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return d === 0 ? "$0" : `${d > 0 ? "+" : "-"}$${abs}`;
}
