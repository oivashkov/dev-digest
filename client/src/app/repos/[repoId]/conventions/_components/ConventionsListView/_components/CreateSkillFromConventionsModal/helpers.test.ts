import { describe, it, expect } from "vitest";
import type { ConventionCandidate } from "@devdigest/shared";
import { defaultSkillName, estimateTokenCount, mergeConventionsToMarkdown, repoSlug, slugifyRule } from "./helpers";

const CANDIDATE_A: ConventionCandidate = {
  id: "c1",
  category: "error_handling",
  rule: "Always use async/await instead of .then() chains",
  evidence_path: "src/api/users.ts",
  evidence_line_range: "23-31",
  evidence_snippet: "const user = await db.users.find(id);",
  confidence: 0.91,
  accepted: true,
};
const CANDIDATE_B: ConventionCandidate = {
  ...CANDIDATE_A,
  id: "c2",
  rule: "Redis access goes through src/lib/redis.ts singleton",
  evidence_path: "src/lib/redis.ts",
  evidence_line_range: "1-9",
  evidence_snippet: "export const redis = new Redis(config.redisUrl);",
};

describe("repoSlug", () => {
  it("drops the owner", () => {
    expect(repoSlug("acme/payments-api")).toBe("payments-api");
    expect(repoSlug("standalone")).toBe("standalone");
  });
});

describe("defaultSkillName", () => {
  it("appends -conventions to the repo slug", () => {
    expect(defaultSkillName("acme/payments-api")).toBe("payments-api-conventions");
  });
});

describe("slugifyRule", () => {
  it("kebab-cases the first few words, dropping punctuation", () => {
    expect(slugifyRule("Always use async/await instead of .then() chains")).toBe("always-use-asyncawait-instead-of-then");
  });
  it("falls back to a generic slug for an empty/punctuation-only rule", () => {
    expect(slugifyRule("...")).toBe("convention");
  });
});

describe("mergeConventionsToMarkdown", () => {
  it("emits one # heading and one ## section per candidate, with a Detected-in code citation", () => {
    const md = mergeConventionsToMarkdown("acme/payments-api", [CANDIDATE_A, CANDIDATE_B]);

    expect(md).toContain("# payments-api-conventions");
    expect(md).toContain("## always-use-asyncawait-instead-of-then");
    expect(md).toContain(CANDIDATE_A.rule);
    expect(md).toContain("Detected in `src/api/users.ts:23-31`:");
    expect(md).toContain(CANDIDATE_A.evidence_snippet);

    expect(md).toContain(CANDIDATE_B.rule);
    expect(md).toContain("Detected in `src/lib/redis.ts:1-9`:");
    expect(md).toContain(CANDIDATE_B.evidence_snippet);
  });

  it("returns just the heading + intro for zero accepted candidates", () => {
    const md = mergeConventionsToMarkdown("acme/payments-api", []);
    expect(md).toContain("# payments-api-conventions");
    expect(md).not.toContain("## ");
  });
});

describe("estimateTokenCount", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokenCount("a".repeat(400))).toBe(100);
    expect(estimateTokenCount("")).toBe(0);
  });
});
