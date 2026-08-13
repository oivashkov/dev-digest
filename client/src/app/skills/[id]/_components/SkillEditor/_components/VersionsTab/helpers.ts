/** A single line-diff row against a base text. */
export interface DiffLine {
  type: "same" | "add" | "remove";
  text: string;
}

/**
 * Line-based diff via a classic LCS dynamic-program — O(n·m) time/space,
 * fine for skill bodies (short markdown documents, not full source files).
 * `a` is the "before" (older) text, `b` the "after" (newer/current) text.
 */
export function diffLines(a: string, b: string): DiffLine[] {
  // "".split("\n") is [""] (one line), not zero lines — an empty body has
  // no lines at all, so special-case it rather than diffing a phantom blank.
  const linesA = a === "" ? [] : a.split("\n");
  const linesB = b === "" ? [] : b.split("\n");
  const n = linesA.length;
  const m = linesB.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        linesA[i] === linesB[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
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
