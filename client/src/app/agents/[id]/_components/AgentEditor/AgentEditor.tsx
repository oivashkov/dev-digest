/* AgentEditor — Config + Skills tabs. Evals/Stats/CI remain future lessons.
   Tab state lives in ?tab=. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { SkillsTab } from "./_components/SkillsTab";
import { ContextTab } from "./_components/ContextTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {/* key={agent.id} remounts (not just re-renders) the active tab when
            the agent changes, so its useState(agent.*) fields re-initialize
            from props for free — no manual resync effect needed. */}
        {tab === "skills" ? (
          <SkillsTab agent={agent} key={agent.id} />
        ) : tab === "context" ? (
          <ContextTab agent={agent} key={agent.id} />
        ) : (
          <ConfigTab agent={agent} key={agent.id} />
        )}
      </div>
    </div>
  );
}
