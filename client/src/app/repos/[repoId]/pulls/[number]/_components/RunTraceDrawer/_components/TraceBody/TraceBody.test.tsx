import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/runs.json";
import { TraceBody } from "./TraceBody";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

const BASE_TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 0, grounding: "0/0 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: null, memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [],
  raw_output: "",
  memory_pulled: [],
  specs_read: [],
  log: [],
};

describe("TraceBody — Project Context (specs_read)", () => {
  it("lists both injected documents with their token counts", () => {
    const trace: RunTrace = {
      ...BASE_TRACE,
      prompt_assembly: { ...BASE_TRACE.prompt_assembly, specs: "spec text" },
      specs_read: [
        { path: "specs/rate-limit.md", tokens: 420, truncated: false },
        { path: "docs/architecture.md", tokens: 90, truncated: true },
      ],
    };
    renderWithIntl(<TraceBody trace={trace} findings={[]} />);

    expect(screen.getByText("specs/rate-limit.md")).toBeInTheDocument();
    expect(screen.getByText("420 tok")).toBeInTheDocument();
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
    expect(screen.getByText("90 tok")).toBeInTheDocument();
    expect(screen.getByText("truncated")).toBeInTheDocument();
  });

  it("renders the 'none' placeholder when specs_read is empty", () => {
    renderWithIntl(<TraceBody trace={BASE_TRACE} findings={[]} />);
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("shows the real per-document token total on the Project context prompt block", () => {
    const trace: RunTrace = {
      ...BASE_TRACE,
      prompt_assembly: { ...BASE_TRACE.prompt_assembly, specs: "spec text" },
      specs_read: [{ path: "specs/a.md", tokens: 100, truncated: false }],
    };
    renderWithIntl(<TraceBody trace={trace} findings={[]} />);
    fireEvent.click(screen.getByText("Prompt assembly"));
    expect(screen.getByText("Project context (dynamic)")).toBeInTheDocument();
    expect(screen.getByText("~100 tok")).toBeInTheDocument();
  });
});
