import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Finding } from "@/lib/types";
import { FindingsCell } from "./FindingsCell";

afterEach(cleanup);

function finding(overrides: Partial<Finding> & Pick<Finding, "id" | "severity">): Finding {
  return {
    category: "bug",
    title: "N+1 query under load",
    file: "src/api/users.ts",
    start_line: 46,
    end_line: 46,
    rationale: "A per-row query inside a loop; batch it with a single IN clause.",
    suggestion: null,
    confidence: 0.86,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    ...overrides,
  };
}

describe("FindingsCell", () => {
  it("renders the muted dash when the PR has never been reviewed", () => {
    render(<FindingsCell findings={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows one badge per non-empty severity, worst-first, and hides zero-count severities", () => {
    const findings = [
      finding({ id: "w1", severity: "WARNING" }),
      finding({ id: "c1", severity: "CRITICAL" }),
      finding({ id: "c2", severity: "CRITICAL" }),
    ];
    render(<FindingsCell findings={findings} />);
    expect(screen.getByText("2")).toBeInTheDocument(); // CRITICAL count
    expect(screen.getByText("1")).toBeInTheDocument(); // WARNING count
    expect(screen.queryByText("Suggestion")).not.toBeInTheDocument();
  });

  it("hovering a severity badge shows a tooltip scoped to only that severity", () => {
    const findings = [
      finding({ id: "w1", severity: "WARNING", title: "Unhandled promise rejection" }),
      finding({ id: "c1", severity: "CRITICAL", title: "Hardcoded secret" }),
    ];
    const { container } = render(<FindingsCell findings={findings} />);

    // groupFindingsBySeverity orders worst-first, so the CRITICAL badge is
    // the cell's first HoverPopover trigger.
    const criticalTrigger = container.querySelector('[style*="inline-flex"]')!;
    fireEvent.mouseEnter(criticalTrigger);

    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("Unhandled promise rejection")).not.toBeInTheDocument();
  });
});
