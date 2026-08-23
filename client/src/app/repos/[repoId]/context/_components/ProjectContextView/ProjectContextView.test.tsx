import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDiscovery, SpecFile } from "@devdigest/shared";
import contextMessages from "../../../../../../../messages/en/context.json";

const useContextFilesMock = vi.fn();
const useContextFileMock = vi.fn();
const useReindexContextMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1" }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/widgets" } }),
  useRepoNotFound: () => false,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/hooks", () => ({
  useContextFiles: (...args: unknown[]) => useContextFilesMock(...args),
  useContextFile: (...args: unknown[]) => useContextFileMock(...args),
  useReindexContext: (...args: unknown[]) => useReindexContextMock(...args),
}));

import { ProjectContextView } from "./ProjectContextView";

afterEach(() => {
  cleanup();
  useContextFilesMock.mockReset();
  useContextFileMock.mockReset();
  useReindexContextMock.mockReset();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <div data-theme="dark">
        <ProjectContextView />
      </div>
    </NextIntlClientProvider>,
  );
}

const DOC_A: SpecFile = { path: "specs/01-feature.md", type: "specs", tokens: 420, size: 1024, updated_at: null };
const DOC_B: SpecFile = { path: "docs/architecture.md", type: "docs", tokens: 90, size: 256, updated_at: null };

function discovery(documents: SpecFile[]): ContextDiscovery {
  return {
    documents,
    degraded: false,
    tokens_total: documents.reduce((sum, d) => sum + d.tokens, 0),
    last_scan_at: new Date().toISOString(),
  };
}

describe("ProjectContextView", () => {
  it("loads documents and selecting one renders its Markdown", async () => {
    useContextFilesMock.mockReturnValue({ data: discovery([DOC_A, DOC_B]), isLoading: false, isError: false });
    useReindexContextMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useContextFileMock.mockReturnValue({
      data: { ...DOC_A, content: "# Feature spec\n\nRATE-LIMIT-DOC-MARKER" },
      isLoading: false,
      isError: false,
    });

    renderWithIntl();

    expect(screen.getByText("specs/01-feature.md")).toBeInTheDocument();
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
    expect(screen.getByText("Select a document to preview its Markdown.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("specs/01-feature.md"));
    expect(await screen.findByText("RATE-LIMIT-DOC-MARKER")).toBeInTheDocument();
  });

  it("shows the empty state when discovery returns zero documents", () => {
    useContextFilesMock.mockReturnValue({ data: discovery([]), isLoading: false, isError: false });
    useReindexContextMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useContextFileMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderWithIntl();

    expect(screen.getByText("No documents found")).toBeInTheDocument();
    expect(screen.queryByText("specs/01-feature.md")).not.toBeInTheDocument();
  });

  it("shows the error state when discovery fails", () => {
    useContextFilesMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("boom") });
    useReindexContextMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useContextFileMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderWithIntl();

    expect(screen.getByText("Couldn’t load documents")).toBeInTheDocument();
  });
});
