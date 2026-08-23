import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDiscovery, Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

const setSkillContextDocsMutate = vi.fn();

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

vi.mock("@/lib/hooks/skills", () => ({
  useSkillContextDocs: () => ({
    data: [{ repo_id: "repo-1", path: "specs/a.md", order: 0, missing: false }],
    isLoading: false,
  }),
  useSetSkillContextDocs: () => ({ mutate: setSkillContextDocsMutate, isPending: false }),
}));

import { ContextSection } from "./ContextSection";

afterEach(() => {
  cleanup();
  setSkillContextDocsMutate.mockReset();
});

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "",
  type: "custom",
  source: "manual",
  body: "x",
  enabled: true,
  version: 1,
  evidence_files: null,
};

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ContextSection skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("ContextSection", () => {
  it("attaching a document persists immediately with the post-toggle set", () => {
    renderWithIntl();

    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();

    const docBRow = screen.getByText("docs/b.md").closest("div")!;
    fireEvent.click(within(docBRow).getByRole("checkbox"));

    expect(setSkillContextDocsMutate).toHaveBeenCalledWith({
      skillId: "sk1",
      repoId: "repo-1",
      paths: expect.arrayContaining(["specs/a.md", "docs/b.md"]),
    });
  });

  it('shows the "SERIALIZES AS" preview with the corrected ## Project context heading', () => {
    renderWithIntl();
    expect(screen.getByText("## Project context")).toBeInTheDocument();
    expect(screen.queryByText("## Project specifications")).not.toBeInTheDocument();
  });
});
