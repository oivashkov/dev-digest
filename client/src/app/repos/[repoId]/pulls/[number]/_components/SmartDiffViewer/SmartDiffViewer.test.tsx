import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import smartDiffMessages from "../../../../../../../../messages/en/smartDiff.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";

const useSmartDiffMock = vi.fn();
const usePrReviewsMock = vi.fn();
const useFindingActionMock = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  useSmartDiff: (...args: unknown[]) => useSmartDiffMock(...args),
  usePrReviews: (...args: unknown[]) => usePrReviewsMock(...args),
  useFindingAction: (...args: unknown[]) => useFindingActionMock(...args),
}));

import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(() => {
  cleanup();
  useSmartDiffMock.mockReset();
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
  file("src/modules/bar/repository.ts", 20, "core change with finding"),
];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        { path: "src/modules/foo/service.ts", additions: 1, deletions: 0, finding_lines: [] },
        {
          path: "src/modules/bar/repository.ts",
          additions: 1,
          deletions: 0,
          finding_lines: [20],
        },
      ],
    },
    {
      role: "wiring",
      files: [{ path: "src/index.ts", additions: 1, deletions: 0, finding_lines: [] }],
    },
    {
      role: "boilerplate",
      files: [
        { path: "package-lock.json", additions: 1, deletions: 0, finding_lines: [] },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 4, proposed_splits: [] },
};

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "SQL injection via string concatenation",
    file: "src/modules/bar/repository.ts",
    start_line: 20,
    end_line: 20,
    rationale: "User input is concatenated directly into the query.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function renderViewer(files: PrFile[] = FILES) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ smartDiff: smartDiffMessages, shell: shellMessages, prReview: prReviewMessages }}
    >
      <SmartDiffViewer prId="pr-1" files={files} />
    </NextIntlClientProvider>,
  );
}

const NO_REVIEWS = { data: [] };
const NO_ACTION = { mutate: vi.fn(), isPending: false };

describe("SmartDiffViewer", () => {
  it("renders groups in core -> wiring -> boilerplate order, keeps boilerplate collapsed by default, and auto-expands a boilerplate file that has findings", () => {
    // Add a boilerplate file WITH findings to prove auto-expand overrides the
    // "boilerplate defaults closed" rule.
    const withBoilerplateFinding: SmartDiff = {
      ...SMART_DIFF,
      groups: SMART_DIFF.groups.map((g) =>
        g.role === "boilerplate"
          ? {
              ...g,
              files: [
                ...g.files,
                { path: "pnpm-lock.yaml", additions: 1, deletions: 0, finding_lines: [3] },
              ],
            }
          : g,
      ),
    };
    useSmartDiffMock.mockReturnValue({ data: withBoilerplateFinding, isLoading: false, isError: false });
    usePrReviewsMock.mockReturnValue({
      data: [
        {
          findings: [
            finding({ id: "f-lockfile", file: "pnpm-lock.yaml", start_line: 3, end_line: 3 }),
          ],
        },
      ],
    });
    useFindingActionMock.mockReturnValue(NO_ACTION);

    renderViewer([...FILES, file("pnpm-lock.yaml", 3, "lockfile finding line")]);

    const labels = screen
      .getAllByText(/Core logic|Wiring|Boilerplate/)
      .map((el) => el.textContent);
    expect(labels).toEqual(["Core logic", "Wiring", "Boilerplate"]);

    // Boilerplate file without findings stays collapsed: its diff text isn't
    // rendered (FileCard defaults to collapsed => body not in the DOM).
    expect(screen.queryByText("boilerplate change")).not.toBeInTheDocument();

    // Boilerplate file WITH findings is auto-expanded despite being boilerplate.
    expect(screen.getByText("lockfile finding line")).toBeInTheDocument();

    // core/wiring files are open by default regardless of findings.
    expect(screen.getByText("core change")).toBeInTheDocument();
    expect(screen.getByText("wiring change")).toBeInTheDocument();
  });

  it("shows one severity badge per finding on a file, not a single aggregate count", () => {
    useSmartDiffMock.mockReturnValue({ data: SMART_DIFF, isLoading: false, isError: false });
    usePrReviewsMock.mockReturnValue({
      data: [
        {
          findings: [
            finding({ id: "f1", severity: "CRITICAL" }),
            finding({ id: "f2", severity: "WARNING", title: "Missing input validation" }),
          ],
        },
      ],
    });
    useFindingActionMock.mockReturnValue(NO_ACTION);
    renderViewer();

    expect(
      screen.getByRole("button", { name: "Show finding: SQL injection via string concatenation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show finding: Missing input validation" }),
    ).toBeInTheDocument();
  });

  it("falls back to the plain (original-order) DiffViewer while loading or on error", () => {
    useSmartDiffMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    usePrReviewsMock.mockReturnValue(NO_REVIEWS);
    useFindingActionMock.mockReturnValue(NO_ACTION);
    const { unmount } = renderViewer();
    // DiffViewer renders every file flat, unsorted into groups — no group
    // headers present.
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.getByText("core change")).toBeInTheDocument();
    unmount();

    useSmartDiffMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderViewer();
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.getByText("core change")).toBeInTheDocument();
  });

  it("clicking a finding badge scrolls to its line AND opens its FindingCard; clicking again closes it", () => {
    useSmartDiffMock.mockReturnValue({ data: SMART_DIFF, isLoading: false, isError: false });
    usePrReviewsMock.mockReturnValue({ data: [{ findings: [finding()] }] });
    useFindingActionMock.mockReturnValue(NO_ACTION);
    renderViewer();

    const scrollIntoView = vi.fn();
    // jsdom doesn't implement scrollIntoView — stub it so CodeLine's effect
    // (triggered via FileCard's scrollToLine/scrollNonce props) doesn't throw.
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const badge = screen.getByRole("button", {
      name: "Show finding: SQL injection via string concatenation",
    });

    // Not open yet — the full card (rationale text) isn't rendered.
    expect(
      screen.queryByText("User input is concatenated directly into the query."),
    ).not.toBeInTheDocument();

    fireEvent.click(badge);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(
      screen.getByText("User input is concatenated directly into the query."),
    ).toBeInTheDocument();

    // Clicking the same badge again closes the card.
    fireEvent.click(badge);
    expect(
      screen.queryByText("User input is concatenated directly into the query."),
    ).not.toBeInTheDocument();
  });

  it("fires accept/dismiss through the opened FindingCard", () => {
    useSmartDiffMock.mockReturnValue({ data: SMART_DIFF, isLoading: false, isError: false });
    usePrReviewsMock.mockReturnValue({ data: [{ findings: [finding()] }] });
    const mutate = vi.fn();
    useFindingActionMock.mockReturnValue({ mutate, isPending: false });
    renderViewer();

    fireEvent.click(
      screen.getByRole("button", { name: "Show finding: SQL injection via string concatenation" }),
    );
    fireEvent.click(screen.getByText("Accept"));
    expect(mutate).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr-1" });
  });

  it("excludes dismissed findings from the badges", () => {
    useSmartDiffMock.mockReturnValue({ data: SMART_DIFF, isLoading: false, isError: false });
    usePrReviewsMock.mockReturnValue({
      data: [{ findings: [finding({ dismissed_at: "2026-08-01T00:00:00.000Z" })] }],
    });
    useFindingActionMock.mockReturnValue(NO_ACTION);
    renderViewer();

    expect(
      screen.queryByRole("button", { name: "Show finding: SQL injection via string concatenation" }),
    ).not.toBeInTheDocument();
  });
});
