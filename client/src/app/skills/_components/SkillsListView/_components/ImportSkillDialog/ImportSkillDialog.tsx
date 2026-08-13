/* ImportSkillDialog — upload a markdown file or zip archive, preview the
   extracted core, and only persist after explicit confirmation. Executable
   archive entries are never read server-side (see skills/helpers.ts). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { ApiError } from "../../../../../../lib/api";
import { useCreateSkill, useImportSkillPreview, type ImportSkillPreview } from "../../../../../../lib/hooks/skills";
import { TYPE_VALUES } from "../../constants";
import { ACCEPT, MODAL_WIDTH } from "./constants";
import { readFileAsBase64 } from "./helpers";
import { s } from "./styles";

export function ImportSkillDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const importPreview = useImportSkillPreview();
  const create = useCreateSkill();

  const [filename, setFilename] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<ImportSkillPreview | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");

  const onFile = async (file: File) => {
    setFilename(file.name);
    const content_base64 = await readFileAsBase64(file);
    importPreview.mutate(
      { filename: file.name, content_base64 },
      {
        onSuccess: (p) => {
          setPreview(p);
          setName(p.name);
          setDescription(p.description);
          setType(p.type);
          setBody(p.body);
        },
      },
    );
  };

  const confirm = async () => {
    if (!preview) return;
    const skill = await create.mutateAsync({
      name: name.trim() || preview.name,
      description,
      type,
      body,
      source: preview.source,
      evidence_files: preview.evidence_files,
    });
    onClose();
    router.push(`/skills/${skill.id}`);
  };

  const error = importPreview.error instanceof ApiError ? importPreview.error.message : null;

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("import.title")}
      subtitle={t("import.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          {preview && (
            <Button kind="primary" icon="Check" onClick={confirm} disabled={create.isPending || !body.trim()}>
              {create.isPending ? t("import.saving") : t("import.save")}
            </Button>
          )}
        </div>
      }
    >
      <div style={s.body}>
        {!preview && (
          <>
            <label style={s.dropzone}>
              <input
                type="file"
                accept={ACCEPT}
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFile(file);
                }}
              />
              {importPreview.isPending
                ? t("import.parsing")
                : filename
                  ? t("import.chosen", { filename })
                  : t("import.dropHint")}
            </label>
            {error && <div style={s.evidence}>{error}</div>}
          </>
        )}
        {preview && (
          <>
            <div style={s.fileRow}>{t("import.parsedFrom", { filename: filename ?? "" })}</div>
            <div style={s.warning}>{t("import.executableWarning")}</div>
            <div style={s.vettingNotice}>{t("import.vettingNotice")}</div>
            <FormField label={t("create.fields.name")} required>
              <TextInput value={name} onChange={setName} />
            </FormField>
            <FormField label={t("create.fields.description")} hint={t("create.fields.descriptionHint")}>
              <TextInput value={description} onChange={setDescription} />
            </FormField>
            <FormField label={t("create.fields.type")}>
              <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={[...TYPE_VALUES]} />
            </FormField>
            <FormField label={t("create.fields.body")} required>
              <Textarea value={body} onChange={setBody} rows={10} mono />
            </FormField>
            {preview.evidence_files.length > 0 && (
              <div style={s.evidence}>{t("import.evidence", { files: preview.evidence_files.join(", ") })}</div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
