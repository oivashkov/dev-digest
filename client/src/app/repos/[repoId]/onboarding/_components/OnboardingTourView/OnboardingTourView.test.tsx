import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingState } from "@devdigest/shared";
import onboardingMessages from "../../../../../../../messages/en/onboarding.json";

const useOnboardingStateMock = vi.fn();
const useGenerateOnboardingMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1" }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: {
      full_name: "acme/widgets",
      default_branch: "main",
      provider: "github",
      host: "github.com",
    },
  }),
  useRepoNotFound: () => false,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/hooks", () => ({
  useOnboardingState: (...args: unknown[]) => useOnboardingStateMock(...args),
  useGenerateOnboarding: (...args: unknown[]) => useGenerateOnboardingMock(...args),
}));

import { OnboardingTourView } from "./OnboardingTourView";

afterEach(() => {
  cleanup();
  useOnboardingStateMock.mockReset();
  useGenerateOnboardingMock.mockReset();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages }}>
      <div data-theme="dark">
        <OnboardingTourView />
      </div>
    </NextIntlClientProvider>,
  );
}

const TOUR = {
  sections: [
    { kind: "architecture", title: "Architecture overview", body: "The system...", diagram: null, links: [] },
    { kind: "critical_paths", title: "Critical paths", body: "These matter...", links: [] },
    {
      kind: "local_setup",
      title: "How to run locally",
      body: "Run `pnpm install`.",
      links: [{ label: "package.json", path: "package.json" }],
    },
    { kind: "reading_path", title: "Guided reading path", body: "Start here...", links: [] },
    { kind: "first_tasks", title: "First tasks", body: "Try a typo fix...", links: [] },
  ],
};

function state(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return { tour: null, status: "empty", generated_at: null, files_indexed: 0, ...overrides };
}

describe("OnboardingTourView", () => {
  it("renders a cached tour's rail, toggles a section collapsed, and copies its setup commands", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    useOnboardingStateMock.mockReturnValue({
      data: state({
        tour: TOUR as OnboardingState["tour"],
        status: "ready",
        generated_at: new Date().toISOString(),
        files_indexed: 120,
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useGenerateOnboardingMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    // The rail lists every section title.
    for (const sec of TOUR.sections) {
      expect(screen.getAllByText(sec.title).length).toBeGreaterThan(0);
    }

    // A header control toggles a section collapsed — its body disappears.
    expect(screen.getByText("The system...")).toBeInTheDocument();
    const architectureOccurrences = screen.getAllByText("Architecture overview");
    fireEvent.click(architectureOccurrences[architectureOccurrences.length - 1]!);
    expect(screen.queryByText("The system...")).not.toBeInTheDocument();

    // The copy control on the local_setup card puts its commands on the clipboard.
    fireEvent.click(screen.getByText("Copy commands"));
    expect(writeText).toHaveBeenCalledWith("Run `pnpm install`.");
  });

  it("empty state: clicking Generate fires the mutation and the control disables while pending", () => {
    const mutate = vi.fn();
    useOnboardingStateMock.mockReturnValue({
      data: state({ status: "empty" }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useGenerateOnboardingMock.mockReturnValue({ mutate, isPending: false });

    const { rerender } = renderWithIntl();

    const regenerateBtn = screen.getByRole("button", { name: "Regenerate" });
    fireEvent.click(regenerateBtn);
    expect(mutate).toHaveBeenCalledTimes(1);

    useGenerateOnboardingMock.mockReturnValue({ mutate, isPending: true });
    rerender(
      <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages }}>
        <div data-theme="dark">
          <OnboardingTourView />
        </div>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: /regenerating/i })).toBeDisabled();
  });

  it("not_indexed: renders its own message and no Generate control", () => {
    useOnboardingStateMock.mockReturnValue({
      data: state({ status: "not_indexed" }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useGenerateOnboardingMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithIntl();

    expect(screen.getByText("Repo is not indexed yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /regenerate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate onboarding tour/i })).not.toBeInTheDocument();
  });
});
