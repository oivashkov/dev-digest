"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { EvalDashboard } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import { useEvalDashboard } from "@/lib/hooks/evals";
import { sinceInputToIso, totalCaseCount } from "@/app/eval/helpers";
import { AgentDashboardCard } from "./_components/AgentDashboardCard";
import { s } from "./styles";

/**
 * `/eval` — workspace-wide Eval Dashboard (SPEC-04 plan, Step 10; ACs
 * 60-73). Lists every enabled agent with its latest metrics + pass
 * fraction (AC 70), a `since` date-range filter (AC 62, via
 * `useEvalDashboard`'s existing `since` param — no new fetch path), and a
 * bulk "Run all agents" action gated behind a confirmation naming the
 * total case count across every agent's set (ACs 72-73). Confirmation uses
 * `window.confirm` — the same native-confirm pattern
 * `useShellContext.ts`'s repo-removal flow already uses in this app for a
 * consequential action, rather than a bespoke Modal component; dismissing
 * it resolves `false` and `handleRunAll` returns without touching
 * `runAllToken`, so no mutation and no LLM call happen (AC 73).
 */
export function EvalDashboardView() {
  const t = useTranslations("eval");
  const tc = useTranslations("common");
  const { data: agents, isLoading: agentsLoading, isError: agentsError, refetch: refetchAgents } = useAgents();
  const [since, setSince] = React.useState("");
  const sinceIso = sinceInputToIso(since);
  const {
    data: dashboards,
    isLoading: dashLoading,
    isError: dashError,
    refetch: refetchDash,
  } = useEvalDashboard(sinceIso);
  // Bumped once per confirmed "Run all agents" click; each AgentDashboardCard
  // watches it and fires its own useDispatchEvalBatch(agent.id) exactly once
  // per bump, so the bulk action reuses the same per-agent hook the per-card
  // "Run eval" button already uses instead of adding a new fetch path.
  const [runAllToken, setRunAllToken] = React.useState(0);

  const enabledAgents = React.useMemo(() => (agents ?? []).filter((a) => a.enabled), [agents]);
  const byOwner = React.useMemo(() => {
    const map = new Map<string, EvalDashboard>();
    for (const d of dashboards ?? []) {
      if (d.owner_id) map.set(d.owner_id, d);
    }
    return map;
  }, [dashboards]);

  const isLoading = agentsLoading || dashLoading;
  const isError = agentsError || dashError;
  const totalCases = totalCaseCount(dashboards ?? []);

  function handleRunAll() {
    if (window.confirm(t("dashboard.confirmRunAll", { count: totalCases }))) {
      setRunAllToken((n) => n + 1);
    }
  }

  return (
    <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
          </div>
          <div style={s.sinceField}>
            <label htmlFor="eval-dashboard-since" style={s.sinceLabel}>
              {t("dashboard.sinceLabel")}
            </label>
            <input
              id="eval-dashboard-since"
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              style={s.sinceInput}
            />
          </div>
          <Button kind="primary" size="sm" onClick={handleRunAll} disabled={enabledAgents.length === 0}>
            {t("dashboard.runAllAgents")}
          </Button>
        </div>

        {isLoading && (
          <div style={s.list}>
            <Skeleton height={160} />
            <Skeleton height={160} />
          </div>
        )}
        {!isLoading && isError && (
          <ErrorState
            onRetry={() => {
              refetchAgents();
              refetchDash();
            }}
          />
        )}
        {!isLoading && !isError && enabledAgents.length === 0 && (
          <EmptyState icon="Cpu" title={tc("states.empty")} />
        )}
        {!isLoading && !isError && enabledAgents.length > 0 && (
          <div style={s.list}>
            {enabledAgents.map((agent) => (
              <AgentDashboardCard
                key={agent.id}
                agent={agent}
                dashboard={byOwner.get(agent.id)}
                runAllToken={runAllToken}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
