import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCase } from "@devdigest/shared";
import evalMessages from "../../../../../../../../../../messages/en/eval.json";
import { ToastProvider } from "@/lib/toast";

const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const runCaseMutateAsync = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
  useRunEvalCase: () => ({ mutateAsync: runCaseMutateAsync, isPending: false }),
}));

import { CaseEditorModal } from "./CaseEditorModal";

afterEach(cleanup);
beforeEach(() => {
  createMutateAsync.mockReset();
  updateMutateAsync.mockReset();
  runCaseMutateAsync.mockReset();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

function renderModal(case_: EvalCase | null = null, onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <ToastProvider>
        <CaseEditorModal agent={AGENT} case_={case_} onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return { onClose };
}

describe("CaseEditorModal", () => {
  it("disables Save while the expected-output textarea holds unparseable JSON, and re-enables it once fixed", () => {
    renderModal();
    const saveBtn = screen.getByRole("button", { name: "Save" });
    const expectedOutputBox = screen.getByDisplayValue("[]");

    // A name is required too — fill it so JSON validity is the only variable
    // for the rest of this test. Valid default JSON ("[]") + a name means
    // Save should already be enabled at this point.
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "my-case" } });
    expect(saveBtn).not.toBeDisabled();
    expect(screen.getByText("valid JSON")).toBeInTheDocument();

    fireEvent.change(expectedOutputBox, { target: { value: "{not json" } });
    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(saveBtn).toBeDisabled();

    fireEvent.change(expectedOutputBox, { target: { value: "[]" } });
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
    expect(saveBtn).not.toBeDisabled();
  });

  it("a valid save persists the case and, with Run on save enabled, runs it immediately after", async () => {
    createMutateAsync.mockResolvedValue({ id: "new-case-id" } as EvalCase);
    runCaseMutateAsync.mockResolvedValue({});
    const { onClose } = renderModal();

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "my-case" } });
    fireEvent.click(screen.getByRole("switch")); // Run on save
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(createMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ owner_kind: "agent", owner_id: "ag1", name: "my-case", expected_output: [] }),
    );
    await waitFor(() => expect(runCaseMutateAsync).toHaveBeenCalledWith("new-case-id"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
