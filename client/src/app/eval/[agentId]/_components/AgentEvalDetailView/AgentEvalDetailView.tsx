"use client";

import React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Icon,
  LineChart,
  MetricCard,
  SelectInput,
  Skeleton,
} from "@devdigest/ui";
import { useAgent, useAgents } from "@/lib/hooks/agents";
import { useAgentEvalDashboard, useDispatchEvalBatch, useEvalBatchStatus } from "@/lib/hooks/evals";
import { sinceInputToIso, trendOrUndefined } from "@/app/eval/helpers";
import { METRIC_COLOR } from "@/app/eval/constants";
import { formatCostUsd } from "@/lib/format";
import { AppShell } from "@/components/app-shell";
// Reused directly, not duplicated — same persisted-history pattern and the
// same Compare modal EvalsTab already uses (client/INSIGHTS.md, 2026-08-27
// Decision: "Compare-runs modal's run history is session-scoped local
// state" + its "Sharper case found" addendum on why that broke this page's
// natural walkthrough too, since it has its own independent mount).
import { CompareRunsModal } from "@/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/_components/CompareRunsModal";
import { formatPct, groupRecentRunsIntoBatches } from "@/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/helpers";
import { pickerOptions, toggleCompareSelection } from "./helpers";
import { s } from "./styles";

/**
 * `/eval/:agentId` — per-agent Eval drill-down (UI-polish follow-up to the
 * SPEC-04 workspace dashboard). Reached by clicking a collapsed row on
 * `/eval` (`AgentDashboardCard`). Shows this one agent's full metric tiles,
 * a combined Recall/Precision/Citation trend chart, an agent picker + the
 * same `since` filter the list page has, a "Run eval" dispatch button, and
 * a recent-runs table — grouped from the persisted `dashboard.recent_runs`
 * (`EvalsTab/helpers.ts#groupRecentRunsIntoBatches`) — feeding the same
 * `CompareRunsModal` `EvalsTab` already uses.
 */
export function AgentEvalDetailView() {
  const t = useTranslations("eval");
  const params = useParams<{ agentId: string }>();
  const router = useRouter();
  const agentId = params.agentId;

  const { data: agent, isLoading: agentLoading, isError: agentError, refetch: refetchAgent } = useAgent(agentId);
  const { data: agents } = useAgents();

  const [since, setSince] = React.useState("");
  const sinceIso = sinceInputToIso(since);
  const {
    data: dashboard,
    isLoading: dashLoading,
    isError: dashError,
    refetch: refetchDash,
  } = useAgentEvalDashboard(agentId, sinceIso);

  const dispatch = useDispatchEvalBatch(agentId);
  const [activeBatchId, setActiveBatchId] = React.useState<string | null>(null);
  const [polling, setPolling] = React.useState(false);
  const batchStatus = useEvalBatchStatus(agentId, activeBatchId, polling);
  const processedBatchIds = React.useRef<Set<string>>(new Set());

  const [selectedKeys, setSelectedKeys] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState(false);

  // Refetch the dashboard once the polled batch reaches done/failed — an
  // external system (the job runner) settling. `persistedRuns` (below)
  // re-derives from the refreshed `dashboard.recent_runs`. Same effect shape
  // as EvalsTab's.
  React.useEffect(() => {
    const data = batchStatus.data;
    if (!data || (data.status !== "done" && data.status !== "failed")) return;
    if (processedBatchIds.current.has(data.batch_id)) return;
    processedBatchIds.current.add(data.batch_id);
    setPolling(false);
    if (data.status === "done") refetchDash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchStatus.data]);

  // Must run before the loading/error early returns below (Rules of Hooks —
  // every hook call has to happen on every render, not just the "data
  // loaded" one). `dashboard` is undefined during those earlier renders;
  // `recent_runs ?? []` keeps the memo's input type-safe either way.
  const persistedRuns = React.useMemo(
    () => groupRecentRunsIntoBatches(dashboard?.recent_runs ?? []),
    [dashboard],
  );

  if (agentLoading) {
    return (
      <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard"), href: "/eval" }]}>
        <div style={s.page}>
          <Skeleton height={160} />
        </div>
      </AppShell>
    );
  }

  if (agentError || !agent) {
    return (
      <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard"), href: "/eval" }]}>
        <div style={s.page}>
          <ErrorState onRetry={() => refetchAgent()} />
        </div>
      </AppShell>
    );
  }

  const running = polling || dispatch.isPending;
  const casesTotal = dashboard?.cases_total ?? 0;

  const dispatchRun = () => {
    dispatch.mutate(undefined, {
      onSuccess: (data) => {
        setActiveBatchId(data.batch_id);
        setPolling(true);
      },
    });
  };

  const toggleSelection = (key: string) => {
    setSelectedKeys((prev) => toggleCompareSelection(prev, key));
  };

  const selectedRuns = persistedRuns.filter((r) => selectedKeys.includes(r.key));

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbSkillsLab") },
        { label: t("page.crumbEvalDashboard"), href: "/eval" },
        { label: agent.name },
      ]}
    >
      <div style={s.page}>
        <Link href="/eval" style={s.backLink}>
          <Icon.ChevronLeft size={14} />
          {t("detail.backToAll")}
        </Link>

        <div style={s.header}>
          <div style={s.headerLeft}>
            <div style={s.titleRow}>
              <h1 style={s.h1}>{agent.name}</h1>
              <Badge mono>{agent.model}</Badge>
            </div>
            <p style={s.subtitle}>
              {t("detail.subtitle", { runs: dashboard?.trend.length ?? 0, cases: dashboard?.cases_total ?? 0 })}
            </p>
          </div>
          <div style={s.headerActions}>
            <div style={s.agentPicker}>
              <SelectInput
                mono={false}
                value={agent.id}
                onChange={(id) => router.push(`/eval/${id}`)}
                options={pickerOptions(agents, agent.id)}
              />
            </div>
            <div style={s.sinceField}>
              <label htmlFor="eval-detail-since" style={s.sinceLabel}>
                {t("dashboard.sinceLabel")}
              </label>
              <input
                id="eval-detail-since"
                type="date"
                value={since}
                onChange={(e) => setSince(e.target.value)}
                style={s.sinceInput}
              />
            </div>
            <Button kind="primary" size="sm" onClick={dispatchRun} loading={running} disabled={casesTotal === 0}>
              {running ? t("dashboard.running") : t("dashboard.runEval", { count: casesTotal })}
            </Button>
          </div>
        </div>

        {dashLoading && <Skeleton height={200} />}

        {!dashLoading && dashError && <ErrorState onRetry={() => refetchDash()} />}

        {!dashLoading && !dashError && dashboard?.alert && <div style={s.alert}>{dashboard.alert}</div>}

        {!dashLoading && !dashError && dashboard && dashboard.current.traces_total > 0 ? (
          <>
            <div style={s.metrics}>
              <MetricCard
                label={t("dashboard.metrics.recall")}
                value={Math.round(dashboard.current.recall * 100)}
                suffix="%"
                delta={dashboard.delta.recall}
                color={METRIC_COLOR.recall}
                trend={trendOrUndefined(dashboard.trend.map((p) => p.recall))}
              />
              <MetricCard
                label={t("dashboard.metrics.precision")}
                value={Math.round(dashboard.current.precision * 100)}
                suffix="%"
                delta={dashboard.delta.precision}
                color={METRIC_COLOR.precision}
                trend={trendOrUndefined(dashboard.trend.map((p) => p.precision))}
              />
              <MetricCard
                label={t("dashboard.metrics.citationAccuracy")}
                value={Math.round(dashboard.current.citation_accuracy * 100)}
                suffix="%"
                delta={dashboard.delta.citation_accuracy}
                color={METRIC_COLOR.citation}
                trend={trendOrUndefined(dashboard.trend.map((p) => p.citation_accuracy))}
              />
            </div>

            <div style={s.chartSection}>
              <div style={s.summary}>{t("dashboard.metricTrend")}</div>
              <LineChart
                series={[
                  { name: t("dashboard.legend.recall"), color: METRIC_COLOR.recall, data: dashboard.trend.map((p) => p.recall) },
                  {
                    name: t("dashboard.legend.precision"),
                    color: METRIC_COLOR.precision,
                    data: dashboard.trend.map((p) => p.precision),
                  },
                  {
                    name: t("dashboard.legend.citation"),
                    color: METRIC_COLOR.citation,
                    data: dashboard.trend.map((p) => p.citation_accuracy),
                  },
                ]}
              />
            </div>
          </>
        ) : (
          !dashLoading && !dashError && <EmptyState icon="Activity" title={t("dashboard.noRuns")} />
        )}

        <div style={s.sectionHeader}>
          <h3 style={s.h3}>{t("dashboard.recentRuns")}</h3>
          <Button
            kind="secondary"
            size="sm"
            icon="Workflow"
            disabled={selectedKeys.length !== 2}
            onClick={() => setComparing(true)}
          >
            {t("compare.title")}
          </Button>
        </div>

        {persistedRuns.length === 0 ? (
          <p style={s.emptyHistory}>{t("detail.noSessionRuns")}</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}></th>
                <th style={s.th}>{t("dashboard.table.version")}</th>
                <th style={s.th}>{t("dashboard.table.ranAt")}</th>
                <th style={s.th}>{t("dashboard.table.recall")}</th>
                <th style={s.th}>{t("dashboard.table.precision")}</th>
                <th style={s.th}>{t("dashboard.table.citation")}</th>
                <th style={s.th}>{t("dashboard.table.cost")}</th>
              </tr>
            </thead>
            <tbody>
              {persistedRuns.map((run) => {
                const checked = selectedKeys.includes(run.key);
                return (
                  <tr key={run.key}>
                    <td style={s.td} title={t("detail.compareCheckboxLabel")}>
                      <Checkbox checked={checked} onChange={() => toggleSelection(run.key)} />
                    </td>
                    <td style={s.td} className="tnum">
                      v{run.agentVersion ?? "?"}
                    </td>
                    <td style={s.td}>{new Date(run.ranAt).toLocaleString()}</td>
                    <td style={s.td} className="tnum">
                      {formatPct(run.result.recall)}
                    </td>
                    <td style={s.td} className="tnum">
                      {formatPct(run.result.precision)}
                    </td>
                    <td style={s.td} className="tnum">
                      {formatPct(run.result.citation_accuracy)}
                    </td>
                    <td style={s.td} className="tnum">
                      {formatCostUsd(run.result.cost_usd)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {comparing && selectedRuns.length === 2 && (
          <CompareRunsModal
            agent={agent}
            left={selectedRuns[0]!}
            right={selectedRuns[1]!}
            onClose={() => {
              setComparing(false);
              setSelectedKeys([]);
            }}
          />
        )}
      </div>
    </AppShell>
  );
}
