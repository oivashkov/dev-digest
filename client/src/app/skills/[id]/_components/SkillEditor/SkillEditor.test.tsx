import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client —
// mirrors AgentEditor.test.tsx's approach.
const restoreMutate = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useSkillStats: () => ({
    data: {
      used_by: 2,
      agents: [{ id: "ag1", name: "Security Reviewer" }],
      pull_frequency_pct: 60,
      accept_rate_pct: 80,
      findings_30d: 5,
      findings_by_category: [
        { category: "security", count: 3 },
        { category: "style", count: 2 },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSkillVersions: () => ({
    data: [
      { skill_id: "sk1", version: 2, summary: "Updated body", body: "v2 body", created_at: "2026-05-30T00:00:00Z" },
      { skill_id: "sk1", version: 1, summary: "Initial version", body: "v1 body", created_at: "2026-03-02T00:00:00Z" },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useRestoreSkillVersion: () => ({ mutate: restoreMutate, isPending: false }),
}));

import { SkillEditor } from "./SkillEditor";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "PR quality rubric",
  description: "General PR quality baseline.",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric\n\nEvaluate the PR against these dimensions.",
  enabled: true,
  version: 2,
  evidence_files: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SkillEditor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save skill")).toBeInTheDocument();
  });

  it("renders the Preview tab as rendered markdown", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="preview" onTab={() => {}} />);
    expect(screen.getByRole("heading", { name: "PR Quality Rubric" })).toBeInTheDocument();
  });

  it("renders the Evals placeholder", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="evals" onTab={() => {}} />);
    expect(screen.getByText("Evals are coming soon")).toBeInTheDocument();
  });

  it("renders the Stats tab's tiles, agent list, and category legend", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="stats" onTab={() => {}} />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("style")).toBeInTheDocument();
  });

  it("renders the Versions tab with the current version badged and history listed", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="versions" onTab={() => {}} />);
    expect(screen.getByText("Updated body")).toBeInTheDocument();
    expect(screen.getByText("Initial version")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Restore")).toBeInTheDocument();
  });
});
