"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Icon, Sparkline } from "@devdigest/ui";
import type { Agent, EvalDashboard } from "@devdigest/shared";
import { hasRecordedRuns, trendOrUndefined } from "@/app/eval/helpers";
import { METRIC_COLOR } from "@/app/eval/constants";
import { useDispatchEvalBatch } from "@/lib/hooks/evals";
import { latestRunRecord } from "./helpers";
import { s } from "./styles";

/**
 * One agent's COLLAPSED row on the workspace Eval Dashboard: icon box, name +
 * model badge, a one-line subtitle ("Last run vN · {date} · {passed}/{total}
 * pass" or the no-runs copy), a compact right-hand sparkline + three colored
 * metric numbers, and a trailing chevron. The whole row is clickable and
 * navigates to the per-agent drill-down page (`/eval/:agentId`) rather than
 * expanding inline — full metric tiles, the trend chart, and the recent-runs
 * table now live there instead.
 *
 * Also the unit the bulk "Run all agents" action fires through —
 * `runAllToken` increments once per confirmed bulk run
 * (`EvalDashboardView`), and this row's own `useDispatchEvalBatch(agent.id)`
 * fires exactly once per token change (`firedTokenRef` guards against
 * re-firing on every render). This hook instance has no visible button here
 * (the per-agent "Run eval" action moved to the drill-down page) but stays
 * mounted so the bulk dispatch still reaches every agent through the same
 * hook the drill-down page's own button uses — no second fetch path.
 */
export function AgentDashboardCard({
  agent,
  dashboard,
  runAllToken,
}: {
  agent: Agent;
  dashboard: EvalDashboard | undefined;
  runAllToken: number;
}) {
  const t = useTranslations("eval");
  const router = useRouter();
  const dispatch = useDispatchEvalBatch(agent.id);
  const firedTokenRef = React.useRef(0);

  React.useEffect(() => {
    if (runAllToken > firedTokenRef.current) {
      firedTokenRef.current = runAllToken;
      dispatch.mutate();
    }
    // Only a new runAllToken should re-fire this — `dispatch` is a fresh
    // useMutation object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runAllToken]);

  const hasRuns = hasRecordedRuns(dashboard);
  const passed = dashboard?.current.traces_passed ?? 0;
  const total = dashboard?.current.traces_total ?? 0;
  const latest = latestRunRecord(dashboard?.recent_runs);

  const subtitle =
    hasRuns && latest
      ? t("dashboard.lastRunSubtitle", {
          version: agent.version,
          ranAt: new Date(latest.ran_at).toLocaleString(),
          passed,
          total,
        })
      : t("dashboard.noRuns");

  return (
    <div style={s.row} onClick={() => router.push(`/eval/${agent.id}`)}>
      <div style={s.iconBox}>
        <Icon.Cpu size={16} />
      </div>
      <div style={s.info}>
        <div style={s.nameRow}>
          <span style={s.name}>{agent.name}</span>
          <Badge mono>{agent.model}</Badge>
        </div>
        <div style={s.subtitle}>{subtitle}</div>
      </div>
      {hasRuns && dashboard && (
        <div style={s.metricsRight}>
          <Sparkline
            data={trendOrUndefined(dashboard.trend.map((p) => p.recall)) ?? []}
            color={METRIC_COLOR.recall}
            w={56}
            h={20}
          />
          <span className="tnum" style={s.metricNum(METRIC_COLOR.recall)} title={t("dashboard.metrics.recall")}>
            {Math.round(dashboard.current.recall * 100)}%
          </span>
          <span
            className="tnum"
            style={s.metricNum(METRIC_COLOR.precision)}
            title={t("dashboard.metrics.precision")}
          >
            {Math.round(dashboard.current.precision * 100)}%
          </span>
          <span
            className="tnum"
            style={s.metricNum(METRIC_COLOR.citation)}
            title={t("dashboard.metrics.citationAccuracy")}
          >
            {Math.round(dashboard.current.citation_accuracy * 100)}%
          </span>
        </div>
      )}
      <Icon.ChevronRight size={18} style={s.chevron} />
    </div>
  );
}
