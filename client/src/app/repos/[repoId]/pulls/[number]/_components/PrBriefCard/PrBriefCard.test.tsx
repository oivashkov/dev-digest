import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrRiskBrief } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { ApiError } from "@/lib/api";

// Mock the data hooks so the card renders without a network/query client —
// mirrors IntentCard.test.tsx's approach.
const usePrBriefMock = vi.fn();
const refreshMutateMock = vi.fn();
const useRefreshPrBriefMock = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  usePrBrief: (...args: unknown[]) => usePrBriefMock(...args),
  useRefreshPrBrief: (...args: unknown[]) => useRefreshPrBriefMock(...args),
}));

import { PrBriefCard } from "./PrBriefCard";

afterEach(() => {
  cleanup();
  usePrBriefMock.mockReset();
  refreshMutateMock.mockReset();
  useRefreshPrBriefMock.mockReset();
  useRefreshPrBriefMock.mockReturnValue({ mutate: refreshMutateMock, isPending: false });
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const BRIEF: PrRiskBrief = {
  pr_id: "pr1",
  what: "Simplifies the retry logic to avoid double-firing webhooks.",
  why: "The webhook consumer was retrying on a transient 5xx, causing duplicates.",
  risk_level: "high",
  risks: [
    {
      kind: "correctness",
      title: "Retry loop can still double-fire",
      explanation: "The backoff window is shorter than the consumer's own timeout.",
      severity: "high",
      file_refs: ["src/webhooks/retry.ts"],
    },
  ],
  review_focus: [
    { file: "src/webhooks/retry.ts", line: 42, reason: "New backoff calculation" },
  ],
  head_sha: "abc123",
};

describe("PrBriefCard (smoke)", () => {
  it("loads and renders what/why, the risk badge, the risks list, and a clickable focus item; clicking it opens the file, and Refresh fires the mutation", () => {
    useRefreshPrBriefMock.mockReturnValue({ mutate: refreshMutateMock, isPending: false });
    usePrBriefMock.mockReturnValue({
      data: BRIEF,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const onOpenFile = vi.fn();

    renderWithIntl(<PrBriefCard prId="pr1" headSha="abc123" onOpenFile={onOpenFile} />);

    expect(screen.getByText(/Simplifies the retry logic/)).toBeInTheDocument();
    expect(screen.getByText(/webhook consumer was retrying/)).toBeInTheDocument();
    // "High risk" renders twice: the overall risk_level badge and this
    // single risk's own severity badge.
    expect(screen.getAllByText("High risk")).toHaveLength(2);
    expect(screen.getByText("Retry loop can still double-fire")).toBeInTheDocument();
    expect(screen.getByText("src/webhooks/retry.ts")).toBeInTheDocument();

    const focusButton = screen.getByRole("button", {
      name: /Open src\/webhooks\/retry.ts:42 in Files changed/,
    });
    fireEvent.click(focusButton);
    expect(onOpenFile).toHaveBeenCalledWith("src/webhooks/retry.ts", 42);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refreshMutateMock).toHaveBeenCalledTimes(1);
  });

  it("renders the unavailable state (no risk badge) on a genuine compute-not-found (404)", () => {
    useRefreshPrBriefMock.mockReturnValue({ mutate: refreshMutateMock, isPending: false });
    usePrBriefMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("Not found", 404),
      refetch: vi.fn(),
    });

    renderWithIntl(<PrBriefCard prId="pr1" />);

    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.queryByText("High risk")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load brief")).not.toBeInTheDocument();
  });

  it("shows the staleness hint alongside the brief content when the PR's headSha has diverged, without triggering a refetch", () => {
    const refetch = vi.fn();
    useRefreshPrBriefMock.mockReturnValue({ mutate: refreshMutateMock, isPending: false });
    usePrBriefMock.mockReturnValue({
      data: BRIEF,
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    });

    renderWithIntl(<PrBriefCard prId="pr1" headSha="def456" />);

    expect(
      screen.getByText("This PR has new commits since this brief was generated."),
    ).toBeInTheDocument();
    // Brief content still renders alongside the hint.
    expect(screen.getByText(/Simplifies the retry logic/)).toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
  });
});
