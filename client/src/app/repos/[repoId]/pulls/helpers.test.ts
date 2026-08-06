import { describe, it, expect } from "vitest";
import type { Finding } from "@/lib/types";
import { groupFindingsBySeverity } from "./helpers";

function finding(overrides: Partial<Finding> & Pick<Finding, "id" | "severity">): Finding {
  return {
    category: "bug",
    title: "Finding",
    file: "src/x.ts",
    start_line: 1,
    end_line: 1,
    rationale: "Because.",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    ...overrides,
  };
}

describe("groupFindingsBySeverity", () => {
  it("returns [] for null/undefined/empty input", () => {
    expect(groupFindingsBySeverity(null)).toEqual([]);
    expect(groupFindingsBySeverity(undefined)).toEqual([]);
    expect(groupFindingsBySeverity([])).toEqual([]);
  });

  it("orders groups worst-first and drops empty severities", () => {
    const findings = [
      finding({ id: "s1", severity: "SUGGESTION" }),
      finding({ id: "c1", severity: "CRITICAL" }),
      finding({ id: "s2", severity: "SUGGESTION" }),
    ];
    const groups = groupFindingsBySeverity(findings);
    // WARNING has zero findings here and must not appear at all.
    expect(groups.map((g) => g.severity)).toEqual(["CRITICAL", "SUGGESTION"]);
    expect(groups.find((g) => g.severity === "CRITICAL")!.findings.map((f) => f.id)).toEqual([
      "c1",
    ]);
    expect(groups.find((g) => g.severity === "SUGGESTION")!.findings.map((f) => f.id)).toEqual([
      "s1",
      "s2",
    ]);
  });
});
