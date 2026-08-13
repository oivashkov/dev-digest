/* /skills/:id — Skill Editor. Split-pane: sidebar skill list (search + Add) +
   the tabbed editor (Config · Preview · Evals · Stats · Versions). Mirrors
   AgentEditorPageView's shape. Tab state lives in ?tab=. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, Dropdown, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkills, useSkill, useUpdateSkill } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { SkillCard } from "@/app/skills/_components/SkillsListView/_components/SkillCard";
import { CreateSkillModal } from "@/app/skills/_components/SkillsListView/_components/CreateSkillModal";
import { ImportSkillDialog } from "@/app/skills/_components/SkillsListView/_components/ImportSkillDialog";
import { filterSkills } from "@/app/skills/_components/SkillsListView/helpers";
import { TYPE_COLOR, typeChipBg } from "@/app/skills/_components/SkillsListView/constants";
import { SkillEditor } from "../SkillEditor";
import { VALID_TABS } from "./constants";
import { s } from "./styles";

export function SkillEditorPageView() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const t = useTranslations("skills");
  const { id } = params;

  const { data: skills } = useSkills();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);
  const update = useUpdateSkill();
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [search_, setSearch] = React.useState("");

  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : "config";
  const setTab = (tb: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", tb);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  const list = filterSkills(skills ?? [], search_);
  const crumb = [{ label: t("list.breadcrumbLab") }, { label: t("list.breadcrumb") }];

  if (isError || (!isLoading && !skill)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("editor.loadErrorTitle")}
          body={error instanceof ApiError ? error.message : t("editor.loadErrorBody")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      {creating && <CreateSkillModal onClose={() => setCreating(false)} />}
      {importing && <ImportSkillDialog onClose={() => setImporting(false)} />}
      <div style={s.layout}>
        {/* left: skill list */}
        <div style={s.sidebar}>
          <div style={s.sidebarHeader}>
            <div style={s.sidebarHeaderRow}>
              <h1 style={s.sidebarTitle}>{t("list.breadcrumb")}</h1>
              <Dropdown
                width={200}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                    {t("list.addSkill")}
                  </Button>
                }
                items={[
                  { label: t("list.createFromScratch"), icon: "Edit", onClick: () => setCreating(true) },
                  { label: t("list.import"), icon: "Upload", onClick: () => setImporting(true) },
                ]}
              />
            </div>
            <div style={s.sidebarSearch}>
              <Icon.Search size={13} style={s.sidebarSearchIcon} />
              <input
                value={search_}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("list.searchPlaceholder")}
                style={s.sidebarSearchInput}
              />
            </div>
          </div>
          <div style={s.sidebarList}>
            {list.map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                active={sk.id === id}
                onClick={() => router.push(`/skills/${sk.id}?tab=${tab}`)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        </div>

        {/* editor */}
        {isLoading || !skill ? (
          <div style={s.editorLoading}>
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={s.editorWrap}>
            <div style={s.editorHeader}>
              <div style={s.editorHeaderIcon}>
                <Icon.Sparkles size={15} />
              </div>
              <h1 style={s.editorHeaderTitle}>{skill.name}</h1>
              <Badge color={TYPE_COLOR[skill.type]} bg={typeChipBg(TYPE_COLOR[skill.type])}>
                {skill.type}
              </Badge>
              <Badge color="var(--text-secondary)" icon="GitCommit" mono>
                {t("preview.version", { version: skill.version })}
              </Badge>
              {!skill.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
              <div style={s.editorHeaderSpacer}>
                {/* No eval-case runner is wired up for skills yet (see the
                    Evals tab) — disabled rather than hidden, so the button
                    still communicates what this action will eventually do. */}
                <Button kind="secondary" size="sm" icon="Play" disabled title={t("editor.runOnEvalsHint")}>
                  {t("editor.runOnEvals")}
                </Button>
              </div>
            </div>
            <div style={s.editorBody}>
              <SkillEditor skill={skill} tab={tab} onTab={setTab} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
