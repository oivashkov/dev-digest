"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

/** Preview tab — the skill's body rendered as markdown, exactly as it's
 *  appended to a reviewing agent's prompt (no execution surface, ever). */
export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("editor.tabs.preview")}</h2>
      <p style={s.subtitle}>{t("preview.renderedHint")}</p>
      <div style={s.card}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
