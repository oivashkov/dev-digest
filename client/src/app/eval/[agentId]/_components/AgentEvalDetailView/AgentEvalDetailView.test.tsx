import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalDashboard, EvalRunRecord } from "@devdigest/shared";
import evalMessages from "../../../../../../messages/en/eval.json";
import { ToastProvider } from "@/lib/toast";

const useAgentMock = vi.fn();
const useAgentsMock = vi.fn();
const restoreMutate = vi.fn();
const useAgentEvalDashboardMock = vi.fn();
const dispatchMutate = vi.fn();
const useEvalBatchStatusMock = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ agentId: "ag-1" }),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgent: (...args: unknown[]) => useAgentMock(...args),
  useAgents: (...args: unknown[]) => useAgentsMock(...args),
  useRestoreAgentVersion: () => ({ mutate: restoreMutate, isPending: false }),
  // CompareRunsModal (rendered once "Compare runs" is clicked) calls this
  // directly — real data/isLoading shape isn't exercised here, only that a
  // render doesn't crash for lack of a mock.
  useAgentVersion: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalDashboard: (...args: unknown[]) => useAgentEvalDashboardMock(...args),
  useDispatchEvalBatch: () => ({
    mutate: (
      _input: undefined,
      opts?: { onSuccess?: (d: { batch_id: string; job_id: string }) => void },
    ) => {
      dispatchMutate();
      opts?.onSuccess?.({ batch_id: "batch-new", job_id: "job-new" });
    },
    isPending: false,
  }),
  useEvalBatchStatus: (...args: unknown[]) => useEvalBatchStatusMock(...args),
}));

import { AgentEvalDetailView } from "./AgentEvalDetailView";

afterEach(() => {
  cleanup();
  useAgentMock.mockReset();
  useAgentsMock.mockReset();
  restoreMutate.mockReset();
  useAgentEvalDashboardMock.mockReset();
  dispatchMutate.mockReset();
  useEvalBatchStatusMock.mockReset();
  pushMock.mockReset();
});

const AGENT: Agent = {
  id: "ag-1",
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

function makeRunRecord(overrides: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: "run-1",
    case_id: "case-1",
    case_name: "case-1",
    ran_at: "2026-08-20T00:00:00Z",
    actual_output: [],
    pass: true,
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 1,
    duration_ms: 1000,
    cost_usd: 0.02,
    agent_version: 1,
    batch_id: "batch-1",
    ...overrides,
  };
}

const DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag-1",
  cases_total: 8,
  current: { recall: 0.75, precision: 0.6, citation_accuracy: 0.9, traces_passed: 6, traces_total: 8, cost_usd: 0.12 },
  delta: { recall: 0.05, precision: -0.1, citation_accuracy: 0 },
  trend: [
    { ran_at: "2026-08-19T00:00:00Z", recall: 0.7, precision: 0.7, citation_accuracy: 0.9, pass_rate: 0.7, cost_usd: 0.1 },
    { ran_at: "2026-08-20T00:00:00Z", recall: 0.75, precision: 0.6, citation_accuracy: 0.9, pass_rate: 0.75, cost_usd: 0.12 },
  ],
  recent_runs: [],
  alert: null,
};

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <ToastProvider>
        <AgentEvalDetailView />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("AgentEvalDetailView", () => {
  it("renders the agent header, stat cards, and trend chart, with the recent-runs table starting empty", () => {
    useAgentMock.mockReturnValue({ data: AGENT, isLoading: false, isError: false, refetch: vi.fn() });
    useAgentsMock.mockReturnValue({ data: [AGENT], isLoading: false, isError: false });
    useAgentEvalDashboardMock.mockReturnValue({
      data: DASHBOARD,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useEvalBatchStatusMock.mockReturnValue({ data: undefined });

    renderView();

    expect(screen.getByRole("heading", { name: "Security Reviewer" })).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("Regression harness · 2 runs on the 8-trace gold set")).toBeInTheDocument();
    // Stat cards (MetricCard, reused as-is) — value and "%" suffix render as
    // separate text nodes, so match on the bare value.
    expect(screen.getByText("75")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
    // No persisted run yet — `dashboard.recent_runs` is empty.
    expect(screen.getByText("Run this agent at least twice to populate the compare table.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare runs" })).toBeDisabled();
  });

  it("groups persisted recent_runs into a batch-level table, caps selection at two, and Compare opens the modal", () => {
    useAgentMock.mockReturnValue({ data: AGENT, isLoading: false, isError: false, refetch: vi.fn() });
    useAgentsMock.mockReturnValue({ data: [AGENT], isLoading: false, isError: false });
    useAgentEvalDashboardMock.mockReturnValue({
      data: {
        ...DASHBOARD,
        // Three DIFFERENT batches (distinct `batch_id`/`agent_version`) — the
        // real, persisted source `groupRecentRunsIntoBatches` reads, not a
        // simulated live dispatch.
        recent_runs: [
          makeRunRecord({ id: "r1", batch_id: "batch-1", agent_version: 1, ran_at: "2026-08-20T00:00:00Z" }),
          makeRunRecord({ id: "r2", batch_id: "batch-2", agent_version: 2, ran_at: "2026-08-20T01:00:00Z" }),
          makeRunRecord({ id: "r3", batch_id: "batch-3", agent_version: 3, ran_at: "2026-08-20T02:00:00Z" }),
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useEvalBatchStatusMock.mockReturnValue({ data: undefined });

    renderView();

    // "Run eval" still dispatches a fresh batch — unaffected by the table
    // now reading persisted data instead of a session-local list.
    fireEvent.click(screen.getByRole("button", { name: /Run eval/ }));
    expect(dispatchMutate).toHaveBeenCalledTimes(1);

    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows).toHaveLength(3);

    // Select all three rows' checkboxes — the third click must be a no-op
    // (cap-at-2, mirroring EvalsTab's toggleCompareSelection).
    for (const row of rows) {
      fireEvent.click(within(row).getByRole("checkbox"));
    }
    const checked = rows.filter((row) => within(row).getByRole("checkbox").getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(2);

    const compareButton = screen.getByRole("button", { name: "Compare runs" });
    expect(compareButton).not.toBeDisabled();
    fireEvent.click(compareButton);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("Compare runs")).toBeInTheDocument();
  });
});
