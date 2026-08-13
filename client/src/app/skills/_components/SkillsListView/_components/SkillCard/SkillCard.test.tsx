import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillSummary } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: SkillSummary = {
  id: "sk1",
  name: "No-mock rule",
  description: "Flag tests that mock the repository layer.",
  type: "convention",
  source: "manual",
  body: "Do not mock the repository.",
  enabled: true,
  version: 1,
  evidence_files: null,
  used_by: 2,
  pull_frequency_pct: 40,
  accept_rate_pct: 75,
};

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SkillCard (smoke)", () => {
  it("renders the skill name and type", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("No-mock rule")).toBeInTheDocument();
    expect(screen.getByText("convention")).toBeInTheDocument();
  });

  it("falls back to a translated placeholder when description is empty", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("shows a 'needs vetting' badge for a disabled, non-manual skill", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "extracted", enabled: false }} />);
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
  });

  it("does not show the vetting badge for a disabled MANUAL skill (user's own choice)", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "manual", enabled: false }} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });

  it("does not show the vetting badge for an already-enabled imported skill", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "extracted", enabled: true }} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });

  it("shows the usage summary line (agents, pull frequency, accept rate)", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("2 agents")).toBeInTheDocument();
    expect(screen.getByText("40% pull")).toBeInTheDocument();
    expect(screen.getByText("75% accept")).toBeInTheDocument();
  });

  it("omits pull/accept when there's no data yet, but still shows the agent count", () => {
    renderWithIntl(
      <SkillCard skill={{ ...SKILL, used_by: 0, pull_frequency_pct: null, accept_rate_pct: null }} />,
    );
    expect(screen.getByText("0 agents")).toBeInTheDocument();
    expect(screen.queryByText(/% pull/)).not.toBeInTheDocument();
    expect(screen.queryByText(/% accept/)).not.toBeInTheDocument();
  });
});
