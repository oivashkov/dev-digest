import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBlastRadius } from "@devdigest/shared";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import briefMessages from "../../../../../../../../messages/en/brief.json";

// Mock the data hook so the card renders without a network/query client —
// mirrors IntentCard.test.tsx's approach.
const useBlastRadiusMock = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  useBlastRadius: (...args: unknown[]) => useBlastRadiusMock(...args),
}));

import { BlastRadiusCard } from "./BlastRadiusCard";

afterEach(() => {
  cleanup();
  useBlastRadiusMock.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: blastMessages, brief: briefMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const DATA: PrBlastRadius = {
  pr_id: "pr1",
  repo_id: "repo1",
  symbols: [
    {
      name: "handleWebhook",
      file: "src/webhooks/handler.ts",
      kind: "function",
      callers: [
        { file: "src/routes/webhooks.ts", symbol: "registerRoutes", line: 42, rank: 3 },
      ],
      endpoints: ["POST /api/webhooks"],
      crons: [],
      callers_truncated: false,
    },
  ],
  impacted_endpoints: ["POST /api/webhooks"],
  impacted_crons: [],
  counts: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
  status: "full",
  reason: null,
};

describe("BlastRadiusCard", () => {
  it("shows stats and symbols, expands a symbol to a clickable caller, then switches to the graph view", () => {
    useBlastRadiusMock.mockReturnValue({
      data: DATA,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderWithIntl(
      <BlastRadiusCard
        prId="pr1"
        repoFullName="acme/widgets"
        repoProvider="github"
        repoHost="github.com"
        headSha="abc123"
      />,
    );

    // Stats + symbol row visible without expanding.
    expect(screen.getByText("handleWebhook")).toBeInTheDocument();
    expect(screen.getByText("src/webhooks/handler.ts")).toBeInTheDocument();

    // Expanding the symbol reveals its resolved caller as a VCS deep-link.
    fireEvent.click(screen.getByRole("button", { name: /handleWebhook/ }));
    const callerLink = screen.getByRole("link", { name: "src/routes/webhooks.ts:42" });
    expect(callerLink).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/blob/abc123/src/routes/webhooks.ts#L42",
    );
    expect(screen.getByText("POST /api/webhooks")).toBeInTheDocument();

    // Switching to Graph swaps the tree for the SVG diagram — both views
    // render from the same already-fetched `data`, no separate query per mode.
    fireEvent.click(screen.getByRole("button", { name: "graph" }));
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
    expect(screen.queryByText("src/routes/webhooks.ts:42")).not.toBeInTheDocument();
  });

  it("shows a degraded-status explanation instead of a silent empty list", () => {
    useBlastRadiusMock.mockReturnValue({
      data: {
        ...DATA,
        symbols: [],
        impacted_endpoints: [],
        counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
        status: "degraded",
        reason: "no_data",
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderWithIntl(<BlastRadiusCard prId="pr1" />);

    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(
      screen.getByText("No repo index is available yet for this repository."),
    ).toBeInTheDocument();
  });

  it("shows the empty state when changed symbols have no downstream callers", () => {
    useBlastRadiusMock.mockReturnValue({
      data: {
        ...DATA,
        symbols: [{ ...DATA.symbols[0], callers: [], endpoints: [], crons: [] }],
        impacted_endpoints: [],
        counts: { symbols: 1, callers: 0, endpoints: 0, crons: 0 },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderWithIntl(<BlastRadiusCard prId="pr1" />);

    expect(
      screen.getByText("1 changed symbol(s), no downstream callers found."),
    ).toBeInTheDocument();
  });
});
