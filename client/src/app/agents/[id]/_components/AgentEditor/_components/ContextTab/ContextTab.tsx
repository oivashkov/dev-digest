/* ContextTab — attach/detach/reorder the agent's Project Context documents
   for the active repo (SPEC-01, Q2/Q3). Every action (check, uncheck, drag,
   move, detach) saves immediately — same auto-save model as SkillsTab; no
   Save button (client/INSIGHTS.md, 2026-08-12). Skill-inherited documents
   (from enabled linked skills) render as a separate, read-only ticked
   section — they can only be detached from the skill itself. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, Icon, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import { useContextFiles } from "@/lib/hooks";
import { useAgentContextDocs, useAgentSkills, useSetAgentContextDocs } from "@/lib/hooks/agents";
import { useSkills, useSkillsContextDocs } from "@/lib/hooks/skills";
import { formatTokenCount } from "@/lib/format";
import { buildInitialOrder, filterPaths, moveItem, reorderTo, unionPaths } from "./helpers";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { repoId } = useActiveRepo();

  const { data: discovery, isLoading: loadingDiscovery } = useContextFiles(repoId);
  const { data: attached, isLoading: loadingAttached } = useAgentContextDocs(agent.id, repoId);
  const { data: links } = useAgentSkills(agent.id);
  const { data: allSkills } = useSkills();
  const setAgentContextDocs = useSetAgentContextDocs();

  const enabledSkillsById = new Map((allSkills ?? []).filter((sk) => sk.enabled).map((sk) => [sk.id, sk]));
  const enabledLinkedSkillIds = [...(links ?? [])]
    .filter((l) => enabledSkillsById.has(l.skill_id))
    .sort((a, b) => a.order - b.order)
    .map((l) => l.skill_id);
  const skillDocsById = useSkillsContextDocs(enabledLinkedSkillIds, repoId);
  const inheritedPaths = unionPaths(...Array.from(skillDocsById.values()).map((docs) => docs.map((d) => d.path)));

  const [filter, setFilter] = React.useState("");
  const [order, setOrder] = React.useState<string[]>([]);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [initialized, setInitialized] = React.useState(false);
  const [draggingPath, setDraggingPath] = React.useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = React.useState<string | null>(null);

  // Reseed local state when the active repo changes (attachments are
  // repo-scoped, Q2) — this tab has no per-repo `key`, so this effect stands
  // in for one.
  const prevRepoId = React.useRef(repoId);
  React.useEffect(() => {
    if (prevRepoId.current !== repoId) {
      prevRepoId.current = repoId;
      setInitialized(false);
    }
  }, [repoId]);

  React.useEffect(() => {
    if (initialized || !discovery || !attached) return;
    const attachedInOrder = [...attached].sort((a, b) => a.order - b.order).map((d) => d.path);
    setOrder(buildInitialOrder(discovery.documents.map((d) => d.path), attachedInOrder));
    setChecked(new Set(attachedInOrder));
    setInitialized(true);
  }, [discovery, attached, initialized]);

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
  const q = filter.trim().toLowerCase();
  const visible = filterPaths(order, filter);
  const tokenTotal = [...checked].reduce((sum, p) => sum + (docByPath.get(p)?.tokens ?? 0), 0);

  /** Persist the given (order, checked) pair immediately, from an
   *  already-computed next value — never from inside a `useState` functional
   *  updater (client/INSIGHTS.md, 2026-08-12: Strict Mode double-invokes
   *  those, firing the mutation twice and racing the server's
   *  delete-then-insert). */
  const persist = (nextOrder: string[], nextChecked: Set<string>) => {
    setAgentContextDocs.mutate({
      agentId: agent.id,
      repoId,
      paths: nextOrder.filter((p) => nextChecked.has(p)),
    });
  };

  const toggle = (path: string) => {
    const next = new Set(checked);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setChecked(next);
    persist(order, next);
  };

  const move = (path: string, direction: -1 | 1) => {
    const next = moveItem(order, path, direction);
    setOrder(next);
    persist(next, checked);
  };

  const dropOn = (draggedPath: string, targetPath: string) => {
    const next = reorderTo(order, draggedPath, targetPath);
    setOrder(next);
    persist(next, checked);
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("context.title")}</h2>
        <span style={s.count}>
          {t("context.attachedCount", { attached: checked.size, total: (discovery?.documents ?? []).length })}
        </span>
        <span style={s.tokenTotal}>{t("context.tokenTotal", { count: formatTokenCount(tokenTotal) })}</span>
        {setAgentContextDocs.isPending && <span style={s.saving}>{t("context.saving")}</span>}
      </div>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t("context.filterPlaceholder")}
        style={s.filterInput}
      />
      {!q && <p style={s.hint}>{t("context.orderHint")}</p>}
      <div style={s.list}>
        {visible.map((path) => {
          const doc = docByPath.get(path);
          const entry = attachedByPath.get(path);
          const missing = entry?.missing ?? !doc;
          const idx = order.indexOf(path);
          return (
            <div
              key={path}
              style={{
                ...s.row,
                ...(draggingPath === path ? s.rowDragging : {}),
                ...(dragOverPath === path && draggingPath !== path ? s.rowDragOver : {}),
                ...(missing ? s.rowMissing : {}),
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggingPath && draggingPath !== path) setDragOverPath(path);
              }}
              onDragLeave={() => setDragOverPath((prev) => (prev === path ? null : prev))}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingPath && draggingPath !== path) dropOn(draggingPath, path);
                setDraggingPath(null);
                setDragOverPath(null);
              }}
            >
              <span
                draggable
                onDragStart={(e) => {
                  setDraggingPath(path);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", path);
                }}
                onDragEnd={() => {
                  setDraggingPath(null);
                  setDragOverPath(null);
                }}
                aria-label={t("context.dragHandle")}
                title={t("context.dragHandle")}
                style={s.dragHandle}
              >
                <Icon.Menu size={13} />
              </span>
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
              <div style={s.moveButtons}>
                <button
                  type="button"
                  aria-label={t("context.moveUp")}
                  disabled={idx === 0}
                  onClick={() => move(path, -1)}
                  style={{ ...s.moveBtn, cursor: idx === 0 ? "not-allowed" : "pointer" }}
                >
                  <Icon.ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  aria-label={t("context.moveDown")}
                  disabled={idx === order.length - 1}
                  onClick={() => move(path, 1)}
                  style={{ ...s.moveBtn, cursor: idx === order.length - 1 ? "not-allowed" : "pointer" }}
                >
                  <Icon.ArrowDown size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <div style={s.empty}>{t("context.noDocuments")}</div>}
      </div>

      {inheritedPaths.size > 0 && (
        <div style={s.inheritedSection}>
          <div style={s.inheritedTitle}>{t("context.inheritedTitle")}</div>
          {[...inheritedPaths].sort().map((path) => (
            <div key={path} style={s.inheritedRow} title={t("context.inheritedHint")}>
              <Checkbox checked onChange={() => {}} />
              <span className="mono" style={s.path}>
                {path}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
