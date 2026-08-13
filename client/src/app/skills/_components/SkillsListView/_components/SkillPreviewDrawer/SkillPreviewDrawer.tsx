/* SkillPreviewDrawer — side panel opened by clicking a skill card. Renders
   the skill's markdown body read-only; "Edit" goes to the full editor page. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Drawer, Badge, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { TYPE_COLOR } from "../../constants";
import { s } from "./styles";

export function SkillPreviewDrawer({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  return (
    <Drawer
      width={560}
      title={skill.name}
      subtitle={t(`card.source.${skill.source}`)}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Badge color={!skill.enabled ? "var(--text-muted)" : "var(--ok)"}>
            {skill.enabled ? t("preview.enabled") : t("preview.disabled")}
          </Badge>
          <Button kind="primary" icon="Edit" onClick={() => router.push(`/skills/${skill.id}`)}>
            {t("preview.edit")}
          </Button>
        </div>
      }
    >
      <div style={s.metaRow}>
        <span style={{ color: TYPE_COLOR[skill.type], fontWeight: 600, fontSize: 13 }}>{skill.type}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("preview.version", { version: skill.version })}</span>
      </div>
      <div style={s.description}>{skill.description || t("card.noDescription")}</div>
      {!skill.enabled && skill.source !== "manual" && (
        <div style={s.untrustedNotice}>{t("preview.untrustedNotice")}</div>
      )}
      <div style={s.bodyBox}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </Drawer>
  );
}
