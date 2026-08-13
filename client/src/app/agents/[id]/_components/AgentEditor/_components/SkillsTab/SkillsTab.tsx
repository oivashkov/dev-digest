/* SkillsTab — attach/detach/reorder the agent's skills. Every action (check,
   uncheck, drag, move) saves immediately via `POST /agents/:id/skills
   { skill_ids }` — matching every other toggle in this app (agent enabled,
   skill enabled), which all persist on click with no separate Save step. An
   earlier "check the boxes, then click Save" version made disabling a skill
   silently no-op if you forgot the extra click, since nothing else in the
   app requires one.

   Reordering has two input methods: native HTML5 drag-and-drop on the grip
   handle (no dnd-kit/react-beautiful-dnd dependency needed — this is a
   single flat list, not a nested/virtualized one, so the native API is
   enough) AND the up/down buttons, kept as the keyboard/screen-reader-
   accessible path since native drag-and-drop has none. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, Icon, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/agents";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import { buildInitialOrder, moveItem, reorderTo } from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { data: allSkills, isLoading: loadingSkills } = useSkills();
  const { data: links, isLoading: loadingLinks } = useAgentSkills(agent.id);
  const setAgentSkills = useSetAgentSkills();
  const [filter, setFilter] = React.useState("");
  const [order, setOrder] = React.useState<string[]>([]);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [initialized, setInitialized] = React.useState(false);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dragOverId, setDragOverId] = React.useState<string | null>(null);

  const linkedIdsInOrder = React.useMemo(
    () => [...(links ?? [])].sort((a, b) => a.order - b.order).map((l) => l.skill_id),
    [links],
  );

  // Seed local (order, checked) state once both queries have loaded — a plain
  // effect (not a key-remount) since this tab doesn't get a fresh key per
  // agent the way ConfigTab does; `initialized` keeps it a one-time seed per
  // mount instead of clobbering in-progress edits on every refetch.
  React.useEffect(() => {
    if (initialized || !allSkills || !links) return;
    setOrder(buildInitialOrder(allSkills.map((sk) => sk.id), linkedIdsInOrder));
    setChecked(new Set(linkedIdsInOrder));
    setInitialized(true);
  }, [allSkills, links, linkedIdsInOrder, initialized]);

  if (loadingSkills || loadingLinks || !initialized) {
    return (
      <div style={s.wrap}>
        <Skeleton height={200} />
      </div>
    );
  }

  const byId = new Map((allSkills ?? []).map((sk) => [sk.id, sk]));
  const q = filter.trim().toLowerCase();
  const visible = order.filter((id) => {
    const sk = byId.get(id);
    return !!sk && (!q || sk.name.toLowerCase().includes(q));
  });

  /** Persist the given (order, checked) pair immediately. Called with an
   *  already-computed next value, from plain event handlers below — NEVER
   *  from inside a `useState` functional updater. React Strict Mode
   *  intentionally double-invokes those to catch impure updaters; a mutate()
   *  call inside one fires the same POST twice, racing on the server's
   *  delete-then-insert and tripping the `agent_skills` PK constraint. */
  const persist = (nextOrder: string[], nextChecked: Set<string>) => {
    setAgentSkills.mutate({
      agentId: agent.id,
      skillIds: nextOrder.filter((id) => nextChecked.has(id)),
    });
  };

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
    persist(order, next);
  };

  const move = (id: string, direction: -1 | 1) => {
    const next = moveItem(order, id, direction);
    setOrder(next);
    persist(next, checked);
  };

  const dropOn = (draggedId: string, targetId: string) => {
    const next = reorderTo(order, draggedId, targetId);
    setOrder(next);
    persist(next, checked);
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <span style={s.count}>
          {t("skills.enabledCount", { linked: checked.size, total: (allSkills ?? []).length })}
        </span>
        {setAgentSkills.isPending && <span style={s.saving}>{t("skills.saving")}</span>}
      </div>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t("skills.filterPlaceholder")}
        style={s.filterInput}
      />
      <p style={s.hint}>{t("skills.orderHint")}</p>
      <div style={s.list}>
        {visible.map((id) => {
          const sk = byId.get(id)!;
          const idx = order.indexOf(id);
          return (
            <div
              key={id}
              style={{
                ...s.row,
                ...(draggingId === id ? s.rowDragging : {}),
                ...(dragOverId === id && draggingId !== id ? s.rowDragOver : {}),
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggingId && draggingId !== id) setDragOverId(id);
              }}
              onDragLeave={() => setDragOverId((prev) => (prev === id ? null : prev))}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingId && draggingId !== id) dropOn(draggingId, id);
                setDraggingId(null);
                setDragOverId(null);
              }}
            >
              <span
                draggable
                onDragStart={(e) => {
                  setDraggingId(id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", id);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDragOverId(null);
                }}
                aria-label={t("skills.dragHandle")}
                title={t("skills.dragHandle")}
                style={s.dragHandle}
              >
                <Icon.Menu size={13} />
              </span>
              <Checkbox checked={checked.has(id)} onChange={() => toggle(id)} />
              <span style={s.name}>{sk.name}</span>
              <span style={s.type}>{sk.type}</span>
              <div style={s.moveButtons}>
                <button
                  type="button"
                  aria-label={t("skills.moveUp")}
                  disabled={idx === 0}
                  onClick={() => move(id, -1)}
                  style={{ ...s.moveBtn, cursor: idx === 0 ? "not-allowed" : "pointer" }}
                >
                  <Icon.ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  aria-label={t("skills.moveDown")}
                  disabled={idx === order.length - 1}
                  onClick={() => move(id, 1)}
                  style={{ ...s.moveBtn, cursor: idx === order.length - 1 ? "not-allowed" : "pointer" }}
                >
                  <Icon.ArrowDown size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <div style={s.empty}>{t("skills.noSkills")}</div>}
      </div>
    </div>
  );
}
