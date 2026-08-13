"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

/** Evals tab — placeholder. No eval-case runner is wired up for skills yet
 *  (EvalCase/EvalRun exist in the shared contract but nothing populates or
 *  executes them for a skill); shown so the tab strip matches the design and
 *  reads as "not built" rather than missing. */
export function EvalsTab() {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <div style={s.iconBox}>
        <Icon.FlaskConical size={20} />
      </div>
      <div style={s.title}>{t("evals.comingSoonTitle")}</div>
      <div style={s.body}>{t("evals.comingSoonBody")}</div>
    </div>
  );
}
