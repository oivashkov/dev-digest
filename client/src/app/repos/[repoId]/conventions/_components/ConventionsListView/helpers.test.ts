import { describe, it, expect } from "vitest";
import type { ConventionCandidate } from "@devdigest/shared";
import { countAccepted, relativeTime } from "./helpers";

function candidate(accepted: boolean): ConventionCandidate {
  return {
    id: Math.random().toString(),
    category: "other",
    rule: "x",
    evidence_path: "x.ts",
    evidence_line_range: "1",
    evidence_snippet: "x",
    confidence: 0.5,
    accepted,
  };
}

describe("countAccepted", () => {
  it("counts only accepted candidates", () => {
    expect(countAccepted([candidate(true), candidate(false), candidate(true)])).toBe(2);
    expect(countAccepted([])).toBe(0);
  });
});

describe("relativeTime", () => {
  it("formats minutes/hours/days ago", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 30_000).toISOString())).toBe("just now");
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(relativeTime(new Date(now - 2 * 3_600_000).toISOString())).toBe("2h ago");
    expect(relativeTime(new Date(now - 3 * 86_400_000).toISOString())).toBe("3d ago");
  });
});
