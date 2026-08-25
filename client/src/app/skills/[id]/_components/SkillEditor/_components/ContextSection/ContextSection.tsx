/* ContextSection — "Project context to use" (SPEC-01). Attaches Project
   Context documents to this skill, scoped to the active repo (Q2). Every
   toggle/detach saves immediately — no Save button (client/INSIGHTS.md,
   2026-08-12). Unlike the Agent editor's ContextTab, this list has NO
   drag-to-reorder control (Q13): the server sorts a skill's attached
   documents by normalized path, and their final position in the assembled
   prompt is decided entirely by the linking agent's composition rule, not
   here. The "Serializes as" preview corrects the old mocked
   "## Project specifications" heading to the shipped `## Project context`
   (Q1). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import { useContextFiles } from "@/lib/hooks";
import { useSetSkillContextDocs, useSkillContextDocs } from "@/lib/hooks/skills";
import { formatTokenCount } from "@/lib/format";
import { buildVisibleList, filterPaths } from "./helpers";
import { s } from "./styles";

export function ContextSection({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { repoId } = useActiveRepo();

  const { data: discovery, isLoading: loadingDiscovery } = useContextFiles(repoId);
  const { data: attached, isLoading: loadingAttached } = useSkillContextDocs(skill.id, repoId);
  const setSkillContextDocs = useSetSkillContextDocs();

  const [filter, setFilter] = React.useState("");
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [initialized, setInitialized] = React.useState(false);

  const prevRepoId = React.useRef(repoId);
  React.useEffect(() => {
    if (prevRepoId.current !== repoId) {
      prevRepoId.current = repoId;
      setInitialized(false);
    }
  }, [repoId]);

  React.useEffect(() => {
    if (initialized || !attached) return;
    setChecked(new Set(attached.map((d) => d.path)));
    setInitialized(true);
  }, [attached, initialized]);

  if (!repoId) {
    return (
      <div style={s.wrap}>
        <p style={s.noRepo}>{t("context.noRepo")}</p>
      </div>
    );
  }

  if (loadingDiscovery || loadingAttached || !initialized) {
    return (
      <div style={s.wrap}>
        <Skeleton height={200} />
      </div>
    );
  }

  const docByPath = new Map((discovery?.documents ?? []).map((d) => [d.path, d]));
  const attachedByPath = new Map((attached ?? []).map((d) => [d.path, d]));
  const visibleAll = buildVisibleList(discovery?.documents.map((d) => d.path) ?? [], [...checked]);
  const visible = filterPaths(visibleAll, filter);

  const persist = (nextChecked: Set<string>) => {
    setSkillContextDocs.mutate({ skillId: skill.id, repoId, paths: [...nextChecked] });
  };

  const toggle = (path: string) => {
    const next = new Set(checked);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setChecked(next);
    persist(next);
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("context.title")}</h2>
        <span style={s.count}>
          {t("context.attachedCount", { attached: checked.size, total: (discovery?.documents ?? []).length })}
        </span>
        {setSkillContextDocs.isPending && <span style={s.saving}>{t("context.saving")}</span>}
      </div>
      <p style={s.subtitle}>{t("context.subtitle")}</p>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t("context.filterPlaceholder")}
        style={s.filterInput}
      />
      <p style={s.hint}>{t("context.hint")}</p>
      <div style={s.list}>
        {visible.map((path) => {
          const doc = docByPath.get(path);
          const entry = attachedByPath.get(path);
          const missing = entry?.missing ?? !doc;
          return (
            <div key={path} style={{ ...s.row, ...(missing ? s.rowMissing : {}) }}>
              <Checkbox checked={checked.has(path)} onChange={() => toggle(path)} />
              <span className="mono" style={s.path}>
                {path}
              </span>
              {missing ? (
                <>
                  <span style={s.missingBadge}>{t("context.missing")}</span>
                  <button type="button" style={s.detachBtn} onClick={() => toggle(path)}>
                    {t("context.detach")}
                  </button>
                </>
              ) : (
                <span style={s.meta}>{doc ? `${doc.type} · ${formatTokenCount(doc.tokens)} tok` : ""}</span>
              )}
            </div>
          );
        })}
        {visible.length === 0 && <div style={s.empty}>{t("context.noDocuments")}</div>}
      </div>

      <div style={s.serializesAs}>
        <div style={s.serializesTitle}>{t("context.serializesAs.title")}</div>
        <div className="mono" style={s.serializesHeading}>
          {t("context.serializesAs.heading")}
        </div>
        <p style={s.serializesHint}>{t("context.serializesAs.hint")}</p>
      </div>
    </div>
  );
}
