import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  category: "error_handling",
  rule: "Always wrap DB calls in a Result type",
  evidence_path: "src/api/users.ts",
  evidence_line_range: "23-31",
  evidence_snippet: "const user = await db.users.find(id);",
  confidence: 0.91,
  accepted: false,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ conventions: messages }}>{ui}</NextIntlClientProvider>);
}

describe("ConventionCard", () => {
  it("renders the rule, evidence file:line, and confidence", () => {
    renderWithIntl(<ConventionCard candidate={CANDIDATE} onUpdate={() => {}} />);
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
  });

  it("fires accept/reject with the right patch", () => {
    const onUpdate = vi.fn();
    renderWithIntl(<ConventionCard candidate={CANDIDATE} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText("Accepted"));
    expect(onUpdate).toHaveBeenCalledWith({ accepted: true });
    fireEvent.click(screen.getByText("Reject"));
    expect(onUpdate).toHaveBeenCalledWith({ accepted: false });
  });

  it("edits rule + evidence in place, then saves via the same onUpdate", () => {
    const onUpdate = vi.fn();
    renderWithIntl(<ConventionCard candidate={CANDIDATE} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText("Edit"));

    const ruleInput = screen.getByDisplayValue(CANDIDATE.rule);
    fireEvent.change(ruleInput, { target: { value: "Always wrap DB calls in a Result<T> type" } });
    fireEvent.click(screen.getByText("Save"));

    expect(onUpdate).toHaveBeenCalledWith({
      rule: "Always wrap DB calls in a Result<T> type",
      evidence_snippet: CANDIDATE.evidence_snippet,
    });
  });
});
