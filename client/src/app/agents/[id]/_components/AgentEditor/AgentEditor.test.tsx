import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
const setAgentSkillsMutate = vi.fn();
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
  useAgentSkills: () => ({
    data: [{ agent_id: "ag1", skill_id: "sk1", order: 0 }],
    isLoading: false,
  }),
  useSetAgentSkills: () => ({ mutate: setAgentSkillsMutate, isPending: false }),
}));

vi.mock("../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({
    data: [
      { id: "sk1", name: "No-mock rule", description: "", type: "convention", source: "manual", body: "x", enabled: true, version: 1, evidence_files: null },
      { id: "sk2", name: "Secret leakage gate", description: "", type: "security", source: "manual", body: "x", enabled: true, version: 1, evidence_files: null },
    ],
    isLoading: false,
  }),
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);
beforeEach(() => setAgentSkillsMutate.mockClear());

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  it("renders the Skills tab with the linked/total counter", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="skills" onTab={() => {}} />);
    expect(screen.getByText("No-mock rule")).toBeInTheDocument();
    expect(screen.getByText("Secret leakage gate")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 enabled")).toBeInTheDocument();
  });

  it("unchecking a linked skill saves immediately — no separate Save step to forget", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="skills" onTab={() => {}} />);
    const row = screen.getByText("No-mock rule").closest("div")!;
    const checkbox = within(row).getByRole("checkbox");
    expect(checkbox).toHaveAttribute("aria-checked", "true");

    fireEvent.click(checkbox);

    expect(checkbox).toHaveAttribute("aria-checked", "false");
    expect(setAgentSkillsMutate).toHaveBeenCalledTimes(1);
    expect(setAgentSkillsMutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: [] });
  });

  it("checking an unlinked skill saves immediately, keeping the already-linked one", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="skills" onTab={() => {}} />);
    const row = screen.getByText("Secret leakage gate").closest("div")!;
    const checkbox = within(row).getByRole("checkbox");
    expect(checkbox).toHaveAttribute("aria-checked", "false");

    fireEvent.click(checkbox);

    expect(setAgentSkillsMutate).toHaveBeenCalledTimes(1);
    expect(setAgentSkillsMutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["sk1", "sk2"] });
  });

  it("dragging a row onto another reorders and saves immediately", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="skills" onTab={() => {}} />);
    const sourceRow = screen.getByText("Secret leakage gate").closest("div")!;
    const targetRow = screen.getByText("No-mock rule").closest("div")!;
    const handle = within(sourceRow).getByLabelText("Drag to reorder");
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };

    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(targetRow, { dataTransfer });
    fireEvent.drop(targetRow, { dataTransfer });

    // sk2 (unlinked, "Secret leakage gate") dragged before sk1 → order
    // becomes [sk2, sk1]; only sk1 is checked, so skillIds still reflects
    // just the attached one, but the persisted order now leads with sk2.
    expect(setAgentSkillsMutate).toHaveBeenCalledTimes(1);
    expect(setAgentSkillsMutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["sk1"] });
  });
});
