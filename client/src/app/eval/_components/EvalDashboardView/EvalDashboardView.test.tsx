import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalDashboard } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import commonMessages from "../../../../../messages/en/common.json";

const useAgentsMock = vi.fn();
const useEvalDashboardMock = vi.fn();
const dispatchMutate = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: (...args: unknown[]) => useAgentsMock(...args),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalDashboard: (...args: unknown[]) => useEvalDashboardMock(...args),
  useDispatchEvalBatch: () => ({ mutate: dispatchMutate, isPending: false }),
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(() => {
  cleanup();
  useAgentsMock.mockReset();
  useEvalDashboardMock.mockReset();
  dispatchMutate.mockReset();
  pushMock.mockReset();
  vi.restoreAllMocks();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
      <div data-theme="dark">
        <EvalDashboardView />
      </div>
    </NextIntlClientProvider>,
  );
}

const AGENT_A: Agent = {
  id: "ag-1",
  name: "Security Reviewer",
  description: "",
  provider: "anthropic",
  model: "claude",
  system_prompt: "",
  output_schema: null,
  enabled: true,
  version: 3,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
};
const AGENT_B: Agent = { ...AGENT_A, id: "ag-2", name: "Style Bot" };
const AGENT_DISABLED: Agent = { ...AGENT_A, id: "ag-3", name: "Retired Bot", enabled: false };

function dashboardFor(ownerId: string): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: ownerId,
    cases_total: 8,
    current: {
      recall: 0.75,
      precision: 0.6,
      citation_accuracy: 0.9,
      traces_passed: 6,
      traces_total: 8,
      cost_usd: 0.12,
    },
    delta: { recall: 0.05, precision: -0.1, citation_accuracy: 0 },
    trend: [
      {
        ran_at: "2026-08-20T00:00:00Z",
        recall: 0.7,
        precision: 0.7,
        citation_accuracy: 0.9,
        pass_rate: 0.7,
        cost_usd: 0.1,
      },
    ],
    recent_runs: [
      {
        id: "run-1",
        case_id: "case-1",
        case_name: "stripe-key-leak",
        ran_at: "2026-08-20T00:00:00Z",
        actual_output: [],
        pass: true,
        recall: 0.75,
        precision: 0.6,
        citation_accuracy: 0.9,
        duration_ms: 1200,
        cost_usd: 0.12,
        agent_version: 1,
        batch_id: "batch-1",
      },
    ],
    alert: null,
  };
}

describe("EvalDashboardView", () => {
  it("lists enabled agents as collapsed rows — name, model badge, subtitle, chevron — and a click navigates to the drill-down page", () => {
    useAgentsMock.mockReturnValue({
      data: [AGENT_A, AGENT_B, AGENT_DISABLED],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useEvalDashboardMock.mockReturnValue({
      data: [dashboardFor("ag-1")],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderWithIntl();

    // Enabled agents render as rows; a disabled agent does not (AC 70).
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Style Bot")).toBeInTheDocument();
    expect(screen.queryByText("Retired Bot")).not.toBeInTheDocument();
    // Row content: model badge, a "Last run …" subtitle for the agent with
    // recorded runs, and the compact colored metric numbers on the right.
    expect(screen.getAllByText("claude").length).toBeGreaterThan(0);
    expect(screen.getByText(/Last run v3/)).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    // Agent B has no dashboard entry at all: the no-runs subtitle renders
    // instead of metric numbers (AC 67) — full detail lives on its own
    // drill-down page now, not inline on this row.
    expect(screen.getByText("No runs yet. Create an eval case and run it.")).toBeInTheDocument();

    // Clicking a row navigates to that agent's drill-down page.
    fireEvent.click(screen.getByText("Security Reviewer"));
    expect(pushMock).toHaveBeenCalledWith("/eval/ag-1");
  });

  it("dismissing the Run-all confirmation fires no mutation; confirming dispatches every enabled agent", () => {
    useAgentsMock.mockReturnValue({
      data: [AGENT_A, AGENT_B],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useEvalDashboardMock.mockReturnValue({
      data: [dashboardFor("ag-1"), dashboardFor("ag-2")],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderWithIntl();
    fireEvent.click(screen.getByRole("button", { name: "Run all agents" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(dispatchMutate).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Run all agents" }));
    expect(dispatchMutate).toHaveBeenCalledTimes(2);
  });
});
