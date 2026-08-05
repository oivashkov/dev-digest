/**
 * ReviewRunAccordion header must show the run's cost next to score/timestamp,
 * same rule as everywhere else RunCostBadge appears: a real number renders as
 * money, a missing one renders "—" — never a made-up "$0.00".
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReviewRecord } from "@devdigest/shared";
import runsMessages from "../../../../../../../../messages/en/runs.json";
import { ReviewRunAccordion } from "./ReviewRunAccordion";

afterEach(cleanup);

function review(o: Partial<ReviewRecord>): ReviewRecord {
  return {
    id: "rev-1",
    pr_id: "pr-1",
    agent_id: "a1",
    run_id: "run-1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: "Two critical exposures.",
    score: 38,
    model: "deepseek/deepseek-v4-flash",
    grounding: "3/3 passed",
    created_at: "2026-06-13T20:52:51.000Z",
    findings: [],
    ...o,
  };
}

function renderAccordion(r: ReviewRecord, cost?: number | null) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
        <ReviewRunAccordion review={r} prId="pr-1" cost={cost} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ReviewRunAccordion — cost badge", () => {
  it("shows the run's cost in the header", () => {
    renderAccordion(review({}), 0.001);
    expect(screen.getByText("$0.001")).toBeInTheDocument();
  });

  it("shows an em dash instead of $0.00 when the run has no cost", () => {
    renderAccordion(review({}), null);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("shows an em dash when cost is omitted entirely", () => {
    renderAccordion(review({}));
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
