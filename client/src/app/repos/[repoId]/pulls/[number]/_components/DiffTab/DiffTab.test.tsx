import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import smartDiffMessages from "../../../../../../../../messages/en/smartDiff.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";

// Mock the data hooks DiffTab (and, transitively, SmartDiffViewer) depend on —
// same boundary SmartDiffViewer.test.tsx uses for `useSmartDiff`.
const useSmartDiffMock = vi.fn();
const usePrCommentsMock = vi.fn();
const useCreatePrCommentMock = vi.fn();
const usePrReviewsMock = vi.fn();
const useFindingActionMock = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  useSmartDiff: (...args: unknown[]) => useSmartDiffMock(...args),
  usePrComments: (...args: unknown[]) => usePrCommentsMock(...args),
  useCreatePrComment: (...args: unknown[]) => useCreatePrCommentMock(...args),
  usePrReviews: (...args: unknown[]) => usePrReviewsMock(...args),
  useFindingAction: (...args: unknown[]) => useFindingActionMock(...args),
}));

import { DiffTab } from "./DiffTab";

afterEach(() => {
  cleanup();
  useSmartDiffMock.mockReset();
  usePrCommentsMock.mockReset();
  useCreatePrCommentMock.mockReset();
  usePrReviewsMock.mockReset();
  useFindingActionMock.mockReset();
});

function patchWithLine(line: number, text: string): string {
  return `@@ -${line},1 +${line},1 @@\n+${text}`;
}

function file(path: string, line = 1, text = "changed"): PrFile {
  return { path, additions: 1, deletions: 0, patch: patchWithLine(line, text) };
}

const FILES: PrFile[] = [
  file("src/modules/foo/service.ts", 10, "core change"),
  file("src/index.ts", 5, "wiring change"),
  file("package-lock.json", 1, "boilerplate change"),
];

const SMART_DIFF: SmartDiff = {
  groups: [
    { role: "core", files: [{ path: "src/modules/foo/service.ts", additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "wiring", files: [{ path: "src/index.ts", additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "boilerplate", files: [{ path: "package-lock.json", additions: 1, deletions: 0, finding_lines: [] }] },
  ],
  split_suggestion: { too_big: false, total_lines: 3, proposed_splits: [] },
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ smartDiff: smartDiffMessages, shell: shellMessages }}>
      <DiffTab prId="pr-1" filesCount={FILES.length} files={FILES} canComment={false} />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab", () => {
  it("defaults to Smart order (grouped SmartDiffViewer), then Original order un-groups it, then Smart order re-groups it", () => {
    useSmartDiffMock.mockReturnValue({ data: SMART_DIFF, isLoading: false, isError: false });
    usePrCommentsMock.mockReturnValue({ data: [] });
    useCreatePrCommentMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    usePrReviewsMock.mockReturnValue({ data: [] });
    useFindingActionMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderTab();

    // Default: Smart order — group headers present; core/wiring auto-expand
    // (their diff text is visible), boilerplate stays collapsed by default
    // (only its file-header path shows, not its diff body text) — same
    // group-role behavior SmartDiffViewer.test.tsx covers directly.
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.getByText("Wiring")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
    expect(screen.getByText("core change")).toBeInTheDocument();
    expect(screen.getByText("wiring change")).toBeInTheDocument();
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();
    expect(screen.queryByText("boilerplate change")).not.toBeInTheDocument();

    // Switch to Original order — the plain flat DiffViewer: no group headers,
    // and every file (including the boilerplate one) opens by its own
    // size-based default instead of the group-role rule, so its diff body is
    // now visible too.
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.queryByText("Wiring")).not.toBeInTheDocument();
    expect(screen.queryByText("Boilerplate")).not.toBeInTheDocument();
    expect(screen.getByText("core change")).toBeInTheDocument();
    expect(screen.getByText("wiring change")).toBeInTheDocument();
    expect(screen.getByText("boilerplate change")).toBeInTheDocument();

    // Switch back to Smart order — grouping returns, boilerplate collapses again.
    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.getByText("Wiring")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
    expect(screen.queryByText("boilerplate change")).not.toBeInTheDocument();
  });

  it("resolves every i18n key it renders to real copy — no raw namespace.key strings leak into the DOM", () => {
    useSmartDiffMock.mockReturnValue({ data: SMART_DIFF, isLoading: false, isError: false });
    usePrCommentsMock.mockReturnValue({ data: [] });
    useCreatePrCommentMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    usePrReviewsMock.mockReturnValue({ data: [] });
    useFindingActionMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const { container } = renderTab();

    // A raw missing-key fallback in this app renders the dotted key itself
    // (e.g. "smartDiff.toggle.smart") — assert none of that shape is present,
    // and that the actual English copy from messages/en/smartDiff.json is.
    expect(container.textContent).not.toMatch(/smartDiff\.[a-zA-Z.]+/);
    expect(screen.getByText("Smart order")).toBeInTheDocument();
    expect(screen.getByText("Original order")).toBeInTheDocument();
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.getByText("the substance of the change")).toBeInTheDocument();
  });
});
