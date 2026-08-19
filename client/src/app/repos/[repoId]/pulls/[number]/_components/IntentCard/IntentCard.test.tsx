import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { ApiError } from "@/lib/api";

// Mock the data hooks so the card renders without a network/query client —
// mirrors SkillEditor.test.tsx's approach.
const usePrIntentMock = vi.fn();
const refreshMutateMock = vi.fn();
const useRefreshPrIntentMock = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: (...args: unknown[]) => usePrIntentMock(...args),
  useRefreshPrIntent: (...args: unknown[]) => useRefreshPrIntentMock(...args),
}));

import { IntentCard } from "./IntentCard";

afterEach(() => {
  cleanup();
  usePrIntentMock.mockReset();
  refreshMutateMock.mockReset();
  useRefreshPrIntentMock.mockReset();
  useRefreshPrIntentMock.mockReturnValue({ mutate: refreshMutateMock, isPending: false });
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const INTENT: PrIntentRecord = {
  pr_id: "pr1",
  intent: "Simplify the retry logic to avoid double-firing webhooks.",
  in_scope: ["retry backoff", "webhook dedupe"],
  out_of_scope: ["auth flow"],
  confidence: 0.87,
  source: "spec",
  plan_refs: ["docs/plans/retry-fix.md"],
  scope_drift: [],
};

describe("IntentCard (smoke)", () => {
  it("renders the intent, scope lists, confidence, source, and plan refs when loaded", () => {
    useRefreshPrIntentMock.mockReturnValue({ mutate: refreshMutateMock, isPending: false });
    usePrIntentMock.mockReturnValue({
      data: INTENT,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithIntl(<IntentCard prId="pr1" />);

    expect(screen.getByText(/Simplify the retry logic/)).toBeInTheDocument();
    expect(screen.getByText("retry backoff")).toBeInTheDocument();
    expect(screen.getByText("webhook dedupe")).toBeInTheDocument();
    expect(screen.getByText("auth flow")).toBeInTheDocument();
    expect(screen.getByText("87% conf")).toBeInTheDocument();
    expect(screen.getByText("from spec")).toBeInTheDocument();
    expect(screen.getByText("docs/plans/retry-fix.md")).toBeInTheDocument();
    // No scope_drift on this fixture — the advisory block must not render.
    expect(screen.queryByText("Possibly out of scope")).not.toBeInTheDocument();
  });

  it("renders the advisory scope-drift block when a changed file overlaps an out_of_scope phrase", () => {
    useRefreshPrIntentMock.mockReturnValue({ mutate: refreshMutateMock, isPending: false });
    usePrIntentMock.mockReturnValue({
      data: {
        ...INTENT,
        scope_drift: [{ file: "src/api/auth/login.ts", matched_phrase: "auth flow" }],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithIntl(<IntentCard prId="pr1" />);

    expect(screen.getByText("Possibly out of scope")).toBeInTheDocument();
    expect(
      screen.getByText('src/api/auth/login.ts — matches “auth flow”'),
    ).toBeInTheDocument();
  });

  it("renders an empty state when the intent hasn't been (successfully) computed yet", () => {
    useRefreshPrIntentMock.mockReturnValue({ mutate: refreshMutateMock, isPending: false });
    usePrIntentMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("Not found", 404),
      refetch: vi.fn(),
    });

    renderWithIntl(<IntentCard prId="pr1" />);

    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load intent")).not.toBeInTheDocument();
  });

  it("renders an error state with retry on a genuine (non-404) failure", () => {
    const refetch = vi.fn();
    useRefreshPrIntentMock.mockReturnValue({ mutate: refreshMutateMock, isPending: false });
    usePrIntentMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("Server error", 500),
      refetch,
    });

    renderWithIntl(<IntentCard prId="pr1" />);
    expect(screen.getByText("Couldn't load intent")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("triggers the refresh mutation from the header button, disabled while pending", () => {
    useRefreshPrIntentMock.mockReturnValue({ mutate: refreshMutateMock, isPending: false });
    usePrIntentMock.mockReturnValue({
      data: INTENT,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithIntl(<IntentCard prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refreshMutateMock).toHaveBeenCalledTimes(1);

    cleanup();
    useRefreshPrIntentMock.mockReturnValue({ mutate: refreshMutateMock, isPending: true });
    renderWithIntl(<IntentCard prId="pr1" />);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
  });
});
