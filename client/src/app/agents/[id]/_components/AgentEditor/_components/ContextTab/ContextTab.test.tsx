import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AttachedContextDoc, ContextDiscovery } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

const setAgentContextDocsMutate = vi.fn();

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "repo-1" }),
}));

vi.mock("@/lib/hooks", () => ({
  useContextFiles: () => ({
    data: {
      documents: [
        { path: "specs/a.md", type: "specs", tokens: 100, size: 10, updated_at: null },
        { path: "docs/b.md", type: "docs", tokens: 50, size: 5, updated_at: null },
      ],
      degraded: false,
      tokens_total: 150,
      last_scan_at: new Date().toISOString(),
    } satisfies ContextDiscovery,
    isLoading: false,
  }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgentContextDocs: () => ({
    data: [
      { repo_id: "repo-1", path: "specs/a.md", order: 0, missing: false },
      { repo_id: "repo-1", path: "specs/gone.md", order: 1, missing: true },
    ] satisfies AttachedContextDoc[],
    isLoading: false,
  }),
  useAgentSkills: () => ({ data: [] }),
  useSetAgentContextDocs: () => ({ mutate: setAgentContextDocsMutate, isPending: false }),
}));

vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: [] }),
  useSkillsContextDocs: () => new Map(),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  setAgentContextDocsMutate.mockReset();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "x",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ContextTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("ContextTab", () => {
  it("ticking an unattached document fires the mutation with the post-toggle set and updates the token total", () => {
    renderWithIntl();

    expect(screen.getByText("~100 tok attached")).toBeInTheDocument();

    const docBRow = screen.getByText("docs/b.md").closest("div")!;
    fireEvent.click(within(docBRow).getByRole("checkbox"));

    expect(setAgentContextDocsMutate).toHaveBeenCalledWith({
      agentId: "ag1",
      repoId: "repo-1",
      paths: ["specs/a.md", "specs/gone.md", "docs/b.md"],
    });
  });

  it("filtering narrows the list to matching paths", () => {
    renderWithIntl();
    expect(screen.getByText("docs/b.md")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Filter documents…"), { target: { value: "specs" } });

    expect(screen.queryByText("docs/b.md")).not.toBeInTheDocument();
    expect(screen.getByText("specs/a.md")).toBeInTheDocument();
  });

  it("a missing row renders its marker and detach control, which unattaches it", () => {
    renderWithIntl();

    expect(screen.getByText("specs/gone.md")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Detach"));
    expect(setAgentContextDocsMutate).toHaveBeenCalledWith({
      agentId: "ag1",
      repoId: "repo-1",
      paths: ["specs/a.md"],
    });
  });
});
