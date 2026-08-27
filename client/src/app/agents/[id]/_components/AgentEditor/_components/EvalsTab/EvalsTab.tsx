/* EvalsTab — the agent editor's Evals tab (SPEC-04 ACs 68-79). Shows the last
   run's four metrics, the full case list with per-case pass/fail (AC 69: a
   never-run case renders distinctly, not as a failure), "Run all evals", and
   per-case Run/Edit/Delete. Opens CaseEditorModal and CompareRunsModal.

   Recent runs / Compare are built from `dashboard.recent_runs` — persisted,
   server-sourced history (`helpers.ts#groupRecentRunsIntoBatches`), not a
   session-scoped in-memory list. See `client/INSIGHTS.md`, 2026-08-27
   Decision, for why an earlier version of this tab used the latter and why
   that broke the natural "run, edit prompt, run again, compare" flow. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, IconBtn, Skeleton } from "@devdigest/ui";
import type { Agent, EvalCase } from "@devdigest/shared";
import {
  useAgentEvalDashboard,
  useDeleteEvalCase,
  useDispatchEvalBatch,
  useEvalBatchStatus,
  useEvalCases,
  useRunEvalCase,
} from "@/lib/hooks/evals";
import { formatCostUsd } from "@/lib/format";
import { CaseEditorModal } from "./_components/CaseEditorModal";
import { CompareRunsModal } from "./_components/CompareRunsModal";
import { deriveCaseStatus, findLatestRun, formatPct, groupRecentRunsIntoBatches } from "./helpers";
import { s } from "./styles";

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");

  const casesQuery = useEvalCases(agent.id);
  const dashboardQuery = useAgentEvalDashboard(agent.id);
  const dispatch = useDispatchEvalBatch(agent.id);
  const runCase = useRunEvalCase(agent.id);
  const deleteCase = useDeleteEvalCase(agent.id);

  const [activeBatchId, setActiveBatchId] = React.useState<string | null>(null);
  const [polling, setPolling] = React.useState(false);
  const batchStatus = useEvalBatchStatus(agent.id, activeBatchId, polling);
  const processedBatchIds = React.useRef<Set<string>>(new Set());

  const [runningCaseId, setRunningCaseId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<EvalCase | "new" | null>(null);
  const [selectedKeys, setSelectedKeys] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState(false);

  // Refetch cases + dashboard once the polled batch reaches done/failed — an
  // external system (the job runner) settling. The new/updated rows this
  // pulls in are what `persistedRuns` (below) then re-derives from.
  React.useEffect(() => {
    const data = batchStatus.data;
    if (!data || (data.status !== "done" && data.status !== "failed")) return;
    if (processedBatchIds.current.has(data.batch_id)) return;
    processedBatchIds.current.add(data.batch_id);
    setPolling(false);
    if (data.status === "done") {
      casesQuery.refetch();
      dashboardQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchStatus.data]);

  if (casesQuery.isError || dashboardQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          casesQuery.refetch();
          dashboardQuery.refetch();
        }}
      />
    );
  }

  if (casesQuery.isLoading || dashboardQuery.isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={24} width={200} />
        <div style={{ marginTop: 14 }}>
          <Skeleton height={120} />
        </div>
      </div>
    );
  }

  const cases = casesQuery.data ?? [];
  const dashboard = dashboardQuery.data;
  const recentRuns = dashboard?.recent_runs;
  const running = polling || dispatch.isPending;
  const persistedRuns = React.useMemo(() => groupRecentRunsIntoBatches(recentRuns ?? []), [recentRuns]);

  const dispatchAll = () => {
    if (cases.length === 0) return;
    dispatch.mutate(undefined, {
      onSuccess: (data) => {
        setActiveBatchId(data.batch_id);
        setPolling(true);
      },
    });
  };

  const runOne = (caseId: string) => {
    setRunningCaseId(caseId);
    runCase.mutate(caseId, { onSettled: () => setRunningCaseId(null) });
  };

  const deleteOne = (c: EvalCase) => {
    if (!window.confirm(t("evalsTab.confirmDelete", { name: c.name }))) return;
    deleteCase.mutate(c.id);
  };

  const toggleCompareSelection = (key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : prev.length < 2 ? [...prev, key] : prev,
    );
  };

  const selectedRuns = persistedRuns.filter((r) => selectedKeys.includes(r.key));

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("evalsTab.metricsTitle")}</h2>
        <div style={s.headerActions}>
          <Button
            kind="primary"
            icon="Play"
            onClick={dispatchAll}
            disabled={cases.length === 0 || running}
          >
            {running ? t("dashboard.running") : t("dashboard.runEval", { count: cases.length })}
          </Button>
        </div>
      </div>
      <p style={s.subtitle}>{t("evalsTab.metricsSubtitle")}</p>

      {dashboard && dashboard.current.traces_total > 0 ? (
        <div style={s.metricsGrid}>
          <MetricTile label={t("dashboard.metrics.recall")} value={formatPct(dashboard.current.recall)} />
          <MetricTile label={t("dashboard.metrics.precision")} value={formatPct(dashboard.current.precision)} />
          <MetricTile
            label={t("dashboard.metrics.citationAccuracy")}
            value={formatPct(dashboard.current.citation_accuracy)}
          />
          <MetricTile
            label={t("dashboard.metrics.tracesPassed")}
            value={`${dashboard.current.traces_passed}/${dashboard.current.traces_total}`}
          />
        </div>
      ) : (
        <p style={{ ...s.subtitle, marginTop: -8 }}>{t("dashboard.noRuns")}</p>
      )}

      <div style={s.sectionHeader}>
        <h3 style={s.h3}>{t("evalsTab.casesHeading")}</h3>
        <div style={s.headerActions}>
          <Button kind="secondary" size="sm" icon="Plus" onClick={() => setEditing("new")}>
            {t("evalsTab.newCase")}
          </Button>
        </div>
      </div>

      {cases.length === 0 ? (
        <EmptyState icon="FlaskConical" title={t("evalsTab.emptyCases")} />
      ) : (
        <div style={s.list}>
          {cases.map((c) => {
            const status = deriveCaseStatus(c.id, recentRuns);
            return (
              <div key={c.id} style={s.row}>
                <StatusBadge state={status.state} t={t} />
                <span style={s.rowName}>{c.name}</span>
                {status.recall != null && <span style={s.rowMeta}>{t("evalsTab.recallSuffix", { recall: Math.round(status.recall * 100) })}</span>}
                <div style={s.rowActions}>
                  <IconBtn
                    icon="Play"
                    label={runningCaseId === c.id ? t("evalsTab.running") : t("evalsTab.run")}
                    onClick={() => runOne(c.id)}
                  />
                  <IconBtn icon="Edit" label={t("evalsTab.edit")} onClick={() => setEditing(c)} />
                  <IconBtn icon="Trash" label={t("evalsTab.delete")} danger onClick={() => deleteOne(c)} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {persistedRuns.length > 1 && (
        <>
          <div style={s.sectionHeader}>
            <h3 style={s.h3}>{t("dashboard.recentRuns")}</h3>
            <div style={s.headerActions}>
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
          </div>
          <div style={s.list}>
            {persistedRuns.map((run) => {
              const selected = selectedKeys.includes(run.key);
              return (
                <div
                  key={run.key}
                  style={{ ...s.historyRow, ...(selected ? s.historyRowSelected : {}) }}
                  onClick={() => toggleCompareSelection(run.key)}
                  role="checkbox"
                  aria-checked={selected}
                >
                  {selected && <Icon.Check size={14} style={{ color: "var(--accent)" }} />}
                  <span style={s.historyMeta}>
                    v{run.agentVersion ?? "?"} · {new Date(run.ranAt).toLocaleTimeString()}
                  </span>
                  <Badge mono>{formatPct(run.result.recall)} recall</Badge>
                  <Badge mono>{formatPct(run.result.precision)} precision</Badge>
                  <Badge mono>{formatCostUsd(run.result.cost_usd)}</Badge>
                </div>
              );
            })}
          </div>
        </>
      )}

      {editing && (
        <CaseEditorModal
          agent={agent}
          case_={editing === "new" ? null : editing}
          lastRun={editing === "new" ? null : findLatestRun(editing.id, recentRuns)}
          onClose={() => setEditing(null)}
        />
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
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.metricTile}>
      <div style={s.metricLabel}>{label}</div>
      <div className="tnum" style={s.metricValue}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ state, t }: { state: "never-run" | "passed" | "failed"; t: (k: string) => string }) {
  if (state === "never-run") return <Badge color="var(--text-muted)">{t("evalsTab.neverRun")}</Badge>;
  if (state === "passed") return <Badge color="var(--ok)" bg="var(--ok-bg)" dot>{t("evalsTab.passed")}</Badge>;
  return <Badge color="var(--crit)" bg="var(--crit-bg)" dot>{t("evalsTab.failed")}</Badge>;
}
