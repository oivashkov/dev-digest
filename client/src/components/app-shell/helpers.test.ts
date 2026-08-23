import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

describe("activeKeyFor", () => {
  it("does not highlight the Onboarding Tour item on the add-repo wizard (/onboarding)", () => {
    expect(activeKeyFor("/onboarding")).not.toBe("onboarding-tour");
  });

  it("highlights the Onboarding Tour item on the repo-scoped route", () => {
    expect(activeKeyFor("/repos/abc/onboarding")).toBe("onboarding-tour");
  });

  it("leaves other repo-scoped routes unchanged", () => {
    expect(activeKeyFor("/repos/abc/context")).toBe("context");
    expect(activeKeyFor("/repos/abc/conventions")).toBe("conventions");
    expect(activeKeyFor("/repos/abc/pulls")).toBe("pulls");
  });
});
