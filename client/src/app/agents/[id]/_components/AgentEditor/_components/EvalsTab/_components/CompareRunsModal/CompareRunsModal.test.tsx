import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentVersion, EvalRun } from "@devdigest/shared";
import evalMessages from "../../../../../../../../../../messages/en/eval.json";
import { ToastProvider } from "@/lib/toast";
import type { PersistedRunEntry } from "../../helpers";

const restoreMutate = vi.fn();

// Maps agent version -> its snapshot's system_prompt, so `useAgentVersion`
// returns the right text for whichever side of the comparison asks —
// mirrors real usage (two independent calls, one per side).
const PROMPT_BY_VERSION: Record<number, string> = {};

function makeVersion(version: number, systemPrompt: string): AgentVersion {
  return {
    agent_id: "ag1",
    version,
    created_at: "2026-08-27T00:00:00.000Z",
    config: {
      provider: "openai",
      model: "gpt-4.1",
      system_prompt: systemPrompt,
      output_schema: null,
      strategy: "single-pass",
      ci_fail_on: "critical",
      repo_intel: true,
      skills: [],
      context_docs: [],
    },
  };
}

vi.mock("@/lib/hooks/agents", () => ({
  useRestoreAgentVersion: () => ({ mutate: restoreMutate, isPending: false }),
  useAgentVersion: (_agentId: unknown, version: number | null | undefined) => {
    if (version == null) return { data: undefined, isLoading: false };
    const prompt = PROMPT_BY_VERSION[version];
    return { data: prompt == null ? undefined : makeVersion(version, prompt), isLoading: false };
  },
}));

import { CompareRunsModal } from "./CompareRunsModal";

afterEach(cleanup);
beforeEach(() => {
  restoreMutate.mockReset();
  for (const k of Object.keys(PROMPT_BY_VERSION)) delete PROMPT_BY_VERSION[Number(k)];
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "current prompt",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

function makeResult(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 1,
    traces_passed: 4,
    traces_total: 5,
    duration_ms: 1000,
    cost_usd: 0.02,
    per_trace: [],
    ...overrides,
  };
}

function renderModal(left: PersistedRunEntry, right: PersistedRunEntry) {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <ToastProvider>
        <CompareRunsModal agent={AGENT} left={left} right={right} onClose={vi.fn()} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("CompareRunsModal", () => {
  it("shows the identical-configuration message and disables both Promote buttons when both runs are already at the live version", () => {
    PROMPT_BY_VERSION[3] = "current prompt";
    const same: PersistedRunEntry = {
      key: "b1",
      batchId: "b1",
      ranAt: "2026-08-27T00:00:00.000Z",
      agentVersion: 3,
      result: makeResult(),
    };
    renderModal(same, { ...same, key: "b2", batchId: "b2", result: makeResult({ recall: 0.5 }) });

    expect(
      screen.getByText("Configuration is identical — both runs ran the same agent version."),
    ).toBeInTheDocument();
    for (const btn of screen.getAllByRole("button", { name: /Promote prompt & model v3/ })) {
      expect(btn).toBeDisabled();
    }
  });

  it("renders a prompt diff and enables Promote only for the non-live side, which restores that version on click", () => {
    window.confirm = vi.fn(() => true);
    PROMPT_BY_VERSION[2] = "old prompt";
    PROMPT_BY_VERSION[3] = "current prompt";
    const older: PersistedRunEntry = {
      key: "b1",
      batchId: "b1",
      ranAt: "2026-08-27T00:00:00.000Z",
      agentVersion: 2,
      result: makeResult(),
    };
    const live: PersistedRunEntry = {
      key: "b2",
      batchId: "b2",
      ranAt: "2026-08-27T01:00:00.000Z",
      agentVersion: 3,
      result: makeResult({ recall: 0.9 }),
    };
    renderModal(older, live);

    expect(screen.queryByText("Configuration is identical — both runs ran the same agent version.")).not.toBeInTheDocument();
    const promoteV2 = screen.getByRole("button", { name: "Promote prompt & model v2" });
    const promoteV3 = screen.getByRole("button", { name: "Promote prompt & model v3" });
    expect(promoteV2).not.toBeDisabled();
    expect(promoteV3).toBeDisabled();

    fireEvent.click(promoteV2);
    expect(restoreMutate).toHaveBeenCalledWith({ agentId: "ag1", version: 2 }, expect.anything());
  });

  it("shows a 'version unknown' note instead of a diff when a run predates version tracking", () => {
    const unknown: PersistedRunEntry = {
      key: "single:run-1",
      batchId: null,
      ranAt: "2026-08-27T00:00:00.000Z",
      agentVersion: null,
      result: makeResult(),
    };
    PROMPT_BY_VERSION[3] = "current prompt";
    const live: PersistedRunEntry = {
      key: "b2",
      batchId: "b2",
      ranAt: "2026-08-27T01:00:00.000Z",
      agentVersion: 3,
      result: makeResult({ recall: 0.9 }),
    };
    renderModal(unknown, live);

    expect(
      screen.getByText(
        "One of these runs predates version tracking, so its system prompt was never recorded — nothing to diff.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Promote prompt & model v?" })).toBeDisabled();
  });
});
