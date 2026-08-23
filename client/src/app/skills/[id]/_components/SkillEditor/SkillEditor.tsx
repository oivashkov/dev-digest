/* SkillEditor — Config · Preview · Evals(stub) · Stats · Versions tabs. Tab
   state lives in ?tab= (owned by the page view). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { ContextSection } from "./_components/ContextSection";
import { EvalsTab } from "./_components/EvalsTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function SkillEditor({ skill, tab, onTab }: { skill: Skill; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("skills");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {/* key={skill.id} remounts (not just re-renders) the active tab when
            the skill changes, so any local useState re-initializes from
            props for free — same trick as AgentEditor. Falls back to Config
            for any unrecognized tab (defensive; the page view already clamps
            ?tab= to TABS before it gets here). */}
        {tab === "preview" ? (
          <PreviewTab skill={skill} key={skill.id} />
        ) : tab === "context" ? (
          <ContextSection skill={skill} key={skill.id} />
        ) : tab === "evals" ? (
          <EvalsTab key={skill.id} />
        ) : tab === "stats" ? (
          <StatsTab skill={skill} key={skill.id} />
        ) : tab === "versions" ? (
          <VersionsTab skill={skill} key={skill.id} />
        ) : (
          <ConfigTab skill={skill} key={skill.id} />
        )}
      </div>
    </div>
  );
}
