"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Skill, SkillStatsAgentUsage, SkillFindingsByCategory } from "@devdigest/shared";
import { useSkillStats } from "@/lib/hooks/skills";
import { CATEGORY_COLOR } from "./constants";
import { s } from "./styles";

/** Stats tab — usage numbers derived from real agent_skills/reviews/findings
 *  rows, using the skill-type → finding-category approximation documented on
 *  `SkillStats` (findings aren't attributed to a specific skill anywhere in
 *  the schema, only to the review that produced them). */
export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skill.id);

  if (isError) {
    return <ErrorState body={t("stats.loadError")} onRetry={() => refetch()} />;
  }
  if (isLoading || !stats) {
    return (
      <div style={s.tilesGrid}>
        <Skeleton height={90} />
        <Skeleton height={90} />
        <Skeleton height={90} />
        <Skeleton height={90} />
      </div>
    );
  }

  const pct = (v: number | null) => (v == null ? "—" : `${v}`);

  return (
    <div style={s.wrap}>
      <div style={s.tilesGrid}>
        <StatTile label={t("stats.usedBy")} value={`${stats.used_by}`} suffix={t("stats.agentsSuffix")} />
        <StatTile
          label={t("stats.pullFrequency")}
          value={pct(stats.pull_frequency_pct)}
          suffix={stats.pull_frequency_pct != null ? "%" : undefined}
        />
        <StatTile
          label={t("stats.acceptRate")}
          value={pct(stats.accept_rate_pct)}
          suffix={stats.accept_rate_pct != null ? "%" : undefined}
          ring={stats.accept_rate_pct}
        />
        <StatTile label={t("stats.findings30d")} value={`${stats.findings_30d}`} />
      </div>

      <div style={s.panelsRow}>
        <div style={s.panel}>
          <div style={s.panelHead}>
            <Icon.Cpu size={13} />
            {t("stats.agentsUsingThisSkill")}
          </div>
          {stats.agents.length === 0 ? (
            <div style={s.emptyNote}>{t("stats.noAgents")}</div>
          ) : (
            stats.agents.map((a) => <AgentRow key={a.id} agent={a} />)
          )}
        </div>

        <div style={s.panel}>
          <div style={s.panelHead}>
            <Icon.Layers size={13} />
            {t("stats.findingsByCategory")}
          </div>
          {stats.findings_by_category.length === 0 ? (
            <div style={s.emptyNote}>{t("stats.noFindings")}</div>
          ) : (
            <CategoryDonut data={stats.findings_by_category} />
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  suffix,
  ring,
}: {
  label: string;
  value: string;
  suffix?: string;
  /** When given, draws a small accept-rate ring next to the label (0–100, or
   *  null for "no data" — an empty track, not a full/empty ring either way). */
  ring?: number | null;
}) {
  return (
    <div style={s.tile}>
      <div style={s.tileHead}>
        <span style={s.tileLabel}>{label}</span>
        {ring !== undefined && <AcceptRing pct={ring} />}
      </div>
      <div style={value === "—" ? s.tileEmpty : s.tileValue}>
        {value}
        {suffix && <span style={s.tileValueSuffix}>{suffix}</span>}
      </div>
    </div>
  );
}

/** Small circular progress ring — hand-rolled SVG (stroke-dasharray), not a
 *  chart library: a single value against its own track, not a series. */
function AcceptRing({ pct }: { pct: number | null }) {
  const r = 12;
  const c = 2 * Math.PI * r;
  const frac = pct == null ? 0 : Math.max(0, Math.min(100, pct)) / 100;
  return (
    <svg width={28} height={28} viewBox="0 0 28 28" aria-hidden>
      <circle cx={14} cy={14} r={r} fill="none" stroke="var(--border)" strokeWidth={3} />
      {pct != null && (
        <circle
          cx={14}
          cy={14}
          r={r}
          fill="none"
          stroke="var(--ok)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          transform="rotate(-90 14 14)"
        />
      )}
    </svg>
  );
}

function AgentRow({ agent }: { agent: SkillStatsAgentUsage }) {
  const t = useTranslations("skills");
  return (
    <div style={s.agentRow}>
      <div style={s.agentIconBox}>
        <Icon.Cpu size={12} />
      </div>
      <span style={s.agentName}>{agent.name}</span>
      <Link href={`/agents/${agent.id}?tab=config`} style={s.agentOpen}>
        {t("stats.open")}
      </Link>
    </div>
  );
}

function CategoryDonut({ data }: { data: SkillFindingsByCategory[] }) {
  const t = useTranslations("skills");
  const total = data.reduce((sum, d) => sum + d.count, 0);
  return (
    <div style={s.donutRow}>
      <div style={{ width: 110, height: 110, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="category"
              innerRadius={32}
              outerRadius={50}
              paddingAngle={data.length > 1 ? 3 : 0}
              stroke="var(--bg-elevated)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.category} fill={CATEGORY_COLOR[d.category]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, _name, entry) => [
                value,
                t(`stats.category.${(entry.payload as SkillFindingsByCategory).category}`),
              ]}
              contentStyle={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div style={s.legend}>
        {data.map((d) => (
          <div key={d.category} style={s.legendRow}>
            <span style={s.legendSwatch(CATEGORY_COLOR[d.category])} />
            <span style={s.legendLabel}>{t(`stats.category.${d.category}`)}</span>
            <span className="tnum" style={s.legendCount}>
              {d.count}
            </span>
          </div>
        ))}
        {total > 0 && <div style={s.emptyNote}>{t("stats.findingsTotal", { count: total })}</div>}
      </div>
    </div>
  );
}
