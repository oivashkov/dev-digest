/* SkillCard — type badge, enabled toggle, delete, usage summary. Mirrors
   AgentCard's shape; reused both in the grid list and the editor sidebar. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { SkillSummary } from "@devdigest/shared";
import { useDeleteSkill } from "../../../../../../lib/hooks/skills";
import { TYPE_COLOR } from "../../constants";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: SkillSummary;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const del = useDeleteSkill();
  const color = TYPE_COLOR[skill.type];
  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={15} />
        </div>
        <span style={s.name}>{skill.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(t("card.confirmDelete", { name: skill.name }))) del.mutate(skill.id);
          }}
          disabled={del.isPending}
          title={t("card.delete")}
          aria-label={t("card.delete")}
          style={{
            background: "none",
            border: "none",
            cursor: del.isPending ? "not-allowed" : "pointer",
            color: "var(--text-muted)",
            display: "inline-flex",
            padding: 4,
          }}
        >
          <Icon.Trash size={14} style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined} />
        </button>
      </div>
      <div style={s.description}>{skill.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <span style={s.typeChip(color)}>{skill.type}</span>
        {skill.source !== "manual" && (
          <Badge color="var(--text-secondary)" icon="Upload">
            {t(`card.source.${skill.source}`)}
          </Badge>
        )}
        {/* Untrusted-source skills default to disabled until a human vets the
            body — this badge is what makes that state legible, vs. reading
            as "someone just turned it off." */}
        {!skill.enabled && skill.source !== "manual" && (
          <span title={t("card.needsVettingTitle")}>
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("card.needsVetting")}
            </Badge>
          </span>
        )}
      </div>
      <div style={s.statsRow}>
        <span>{t("card.stats.agents", { count: skill.used_by })}</span>
        {skill.pull_frequency_pct != null && (
          <span>{t("card.stats.pull", { pct: skill.pull_frequency_pct })}</span>
        )}
        {skill.accept_rate_pct != null && (
          <span className="tnum" style={s.acceptStat}>
            {t("card.stats.accept", { pct: skill.accept_rate_pct })}
          </span>
        )}
      </div>
    </div>
  );
}
