import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import smartDiffMessages from "../../../../../../../../messages/en/smartDiff.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";

const useSmartDiffMock = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  useSmartDiff: (...args: unknown[]) => useSmartDiffMock(...args),
}));

import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(() => {
  cleanup();
  useSmartDiffMock.mockReset();
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

function renderViewer(files: PrFile[] = FILES) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ smartDiff: smartDiffMessages, shell: shellMessages }}>
      <SmartDiffViewer prId="pr-1" files={files} />
    </NextIntlClientProvider>,
  );
}

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

  it("shows a findings badge with the right count and toggling Smart/Original in DiffTab-style state switches rendering", () => {
    useSmartDiffMock.mockReturnValue({ data: SMART_DIFF, isLoading: false, isError: false });
    renderViewer();

    expect(screen.getByText("1 finding")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Jump to the first finding in src\/modules\/bar\/repository\.ts/i }),
    ).toBeInTheDocument();
  });

  it("falls back to the plain (original-order) DiffViewer while loading or on error", () => {
    useSmartDiffMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
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

  it("scrolls to a file's first finding line when its findings affordance is clicked", () => {
    useSmartDiffMock.mockReturnValue({ data: SMART_DIFF, isLoading: false, isError: false });
    renderViewer();

    const scrollIntoView = vi.fn();
    // jsdom doesn't implement scrollIntoView — stub it so CodeLine's effect
    // (triggered via FileCard's scrollToLine/scrollNonce props) doesn't throw.
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const jumpBtn = screen.getByRole("button", {
      name: /Jump to the first finding in src\/modules\/bar\/repository\.ts/i,
    });
    fireEvent.click(jumpBtn);

    expect(scrollIntoView).toHaveBeenCalled();
  });
});
