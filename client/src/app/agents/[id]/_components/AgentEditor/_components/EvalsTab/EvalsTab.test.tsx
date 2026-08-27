import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCase, EvalDashboard } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import { ToastProvider } from "@/lib/toast";

const dispatchMutate = vi.fn();
const runCaseMutate = vi.fn();
const deleteCaseMutate = vi.fn();

const CASES: EvalCase[] = [
  {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "stripe-key-leak",
    input_diff: "--- a/x\n+++ b/x\n@@ -1,1 +1,2 @@\n+leak",
    input_files: null,
    input_meta: null,
    expected_output: [{ expect: "must_find", file: "x", start_line: 1 }],
    notes: null,
  },
  {
    id: "case-2",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "no-op-diff",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: [],
    notes: null,
  },
];

const DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 2,
  current: { recall: 0.5, precision: 1, citation_accuracy: 1, traces_passed: 1, traces_total: 2, cost_usd: 0.01 },
  delta: { recall: 0, precision: 0, citation_accuracy: 0 },
  trend: [],
  // Only case-2 has a run — case-1 is deliberately absent so it renders the
  // never-run state (AC 69), not a false failure.
  recent_runs: [
    {
      id: "run-1",
      case_id: "case-2",
      case_name: "no-op-diff",
      ran_at: "2026-08-27T00:00:00.000Z",
      actual_output: [],
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      duration_ms: 500,
      cost_usd: 0.01,
      agent_version: 1,
      batch_id: "batch-1",
    },
  ],
  alert: null,
};

const useEvalCases = vi.fn(() => ({ data: CASES, isLoading: false, isError: false, refetch: vi.fn() }));
const useAgentEvalDashboard = vi.fn(() => ({ data: DASHBOARD, isLoading: false, isError: false, refetch: vi.fn() }));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: (...args: unknown[]) => useEvalCases(...(args as [])),
  useAgentEvalDashboard: (...args: unknown[]) => useAgentEvalDashboard(...(args as [])),
  useDispatchEvalBatch: () => ({ mutate: dispatchMutate, isPending: false }),
  useEvalBatchStatus: () => ({ data: undefined }),
  useRunEvalCase: () => ({ mutate: runCaseMutate, isPending: false }),
  useDeleteEvalCase: () => ({ mutate: deleteCaseMutate, isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  dispatchMutate.mockClear();
  runCaseMutate.mockClear();
  deleteCaseMutate.mockClear();
  useEvalCases.mockClear();
  useEvalCases.mockReturnValue({ data: CASES, isLoading: false, isError: false, refetch: vi.fn() });
  useAgentEvalDashboard.mockClear();
  useAgentEvalDashboard.mockReturnValue({ data: DASHBOARD, isLoading: false, isError: false, refetch: vi.fn() });
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <ToastProvider>
        <EvalsTab agent={AGENT} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab", () => {
  it("renders each case's status — never-run stays distinct from failing — and Run all evals dispatches a batch", () => {
    renderTab();

    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("no-op-diff")).toBeInTheDocument();
    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.queryByText("failed")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Run eval (2)"));
    expect(dispatchMutate).toHaveBeenCalledTimes(1);
  });

  it("shows the empty-cases state and disables Run all evals when the agent has zero cases", () => {
    useEvalCases.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    expect(
      screen.getByText("No eval cases yet. Create one to assert this agent's expected findings on a sample diff."),
    ).toBeInTheDocument();
    expect(screen.getByText("Run eval (0)").closest("button")).toBeDisabled();
  });
});
