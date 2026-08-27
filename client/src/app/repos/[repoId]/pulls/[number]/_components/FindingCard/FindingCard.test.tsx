import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

// Mock the eval-case hook so "Turn into eval case" renders and can be
// clicked without a network/query client — mirrors PrBriefCard.test.tsx's
// approach for a directly-called mutation hook.
const createEvalCaseMutateMock = vi.fn();
const useCreateEvalCaseFromFinding = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCaseFromFinding: (...args: unknown[]) => useCreateEvalCaseFromFinding(...args),
}));

import { FindingCard } from "./FindingCard";

beforeEach(() => {
  useCreateEvalCaseFromFinding.mockReturnValue({
    mutate: createEvalCaseMutateMock,
    isPending: false,
    isSuccess: false,
  });
});

afterEach(() => {
  cleanup();
  createEvalCaseMutateMock.mockReset();
  useCreateEvalCaseFromFinding.mockReset();
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — Turn into eval case (SPEC-04 ACs 8-18)", () => {
  it("un-actioned finding: the control is disabled rather than letting the request round-trip to the server's 400 (AC 17)", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);

    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(createEvalCaseMutateMock).not.toHaveBeenCalled();
  });

  it("accepted finding: clicking creates a case via the hook directly, and success shows a confirmation state", () => {
    const acceptedFinding: FindingRecord = { ...FINDING, accepted_at: "2026-08-27T00:00:00Z" };
    const { rerender } = renderWithIntl(
      <FindingCard f={acceptedFinding} defaultExpanded onAction={() => {}} />,
    );

    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(createEvalCaseMutateMock).toHaveBeenCalledWith(
      acceptedFinding.id,
      expect.objectContaining({ onError: expect.any(Function) }),
    );

    // Simulate the mutation having resolved — same technique
    // PrBriefCard.test.tsx uses for a mocked hook's post-mutation state.
    useCreateEvalCaseFromFinding.mockReturnValue({
      mutate: createEvalCaseMutateMock,
      isPending: false,
      isSuccess: true,
    });
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingCard f={acceptedFinding} defaultExpanded onAction={() => {}} />
      </NextIntlClientProvider>,
    );

    const doneButton = screen.getByRole("button", { name: "Turn into eval case" });
    expect(doneButton).toBeDisabled();
    expect(doneButton).toHaveAttribute("title", "Eval case created.");
  });

  it("dismissed finding: the control is enabled (mirrors the must_not_flag direction, AC 10)", () => {
    const dismissedFinding: FindingRecord = { ...FINDING, dismissed_at: "2026-08-27T00:00:00Z" };
    renderWithIntl(<FindingCard f={dismissedFinding} defaultExpanded onAction={() => {}} />);

    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).not.toBeDisabled();
  });
});
