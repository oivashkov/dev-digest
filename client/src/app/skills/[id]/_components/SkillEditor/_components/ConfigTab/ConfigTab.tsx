"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, Textarea, Toggle, Button, Icon } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { TYPE_VALUES } from "@/app/skills/_components/SkillsListView/constants";
import { s } from "./styles";

/** Config tab — name/description/type/body + enabled toggle. Skills carry no
 *  provider/model config, so this is the whole editable surface. */
export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);
  // No resync effect: SkillEditor renders this with key={skill.id}, so React
  // remounts (not just re-renders) ConfigTab on skill change — the useState
  // initializers above re-run from the new props automatically.

  const typeOptions = TYPE_VALUES.map((v) => ({ value: v, label: v }));

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body, enabled } },
      { onSuccess: (data) => toast.success(t("editor.savedToast", { version: data.version })) },
    );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("editor.configTitle")}</h2>
        <Icon.GitCommit size={13} style={{ color: "var(--text-muted)" }} />
        <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("preview.version", { version: skill.version })}
        </span>
        <label style={s.enabledLabel}>
          {t("editor.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>

      {!enabled && skill.source !== "manual" && (
        <div style={s.untrustedNotice}>
          <Icon.AlertTriangle size={14} />
          {t("editor.untrustedNotice")}
        </div>
      )}

      <FormField label={t("create.fields.name")} required>
        <TextInput value={name} onChange={setName} />
      </FormField>
      <FormField label={t("create.fields.description")} hint={t("create.fields.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("create.fields.type")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
      </FormField>
      <FormField label={t("create.fields.body")} hint={t("editor.bodyHint")} required>
        <Textarea value={body} onChange={setBody} rows={16} mono />
      </FormField>

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending || !body.trim()}>
          {update.isPending ? t("editor.saving") : t("editor.save")}
        </Button>
        {update.isSuccess && (
          <span style={s.savedNote}>{t("editor.saved", { version: update.data?.version })}</span>
        )}
      </div>
    </div>
  );
}
