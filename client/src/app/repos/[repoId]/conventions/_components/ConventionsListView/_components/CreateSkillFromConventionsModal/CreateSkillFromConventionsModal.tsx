"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, Modal, SelectInput, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { ConventionCandidate, SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { DEFAULT_TYPE, MODAL_WIDTH, TYPE_VALUES } from "./constants";
import { defaultSkillName, estimateTokenCount, mergeConventionsToMarkdown } from "./helpers";
import { s } from "./styles";

/**
 * "Create skill from conventions" — merges the accepted candidates into an
 * editable skill body (name/description/type/enabled/body all editable
 * before save). Reuses `useCreateSkill` verbatim; no new skills-side server
 * code. Stays on the Conventions page after save (no redirect to /skills/:id
 * — the mockup shows no such handoff).
 */
export function CreateSkillFromConventionsModal({
  repoFullName,
  acceptedCandidates,
  onClose,
}: {
  repoFullName: string;
  acceptedCandidates: ConventionCandidate[];
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const create = useCreateSkill();

  const [name, setName] = React.useState(() => defaultSkillName(repoFullName));
  const [description, setDescription] = React.useState(
    () => `${acceptedCandidates.length} house conventions extracted from ${repoFullName}`,
  );
  const [type, setType] = React.useState<SkillType>(DEFAULT_TYPE);
  // Default ENABLED — deliberate deviation from SkillsRepository.insert's
  // "extracted source defaults disabled" rule: that rule guards against an
  // untrusted import silently reaching a prompt, but here the user has just
  // explicitly reviewed and accepted every line below.
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState(() => mergeConventionsToMarkdown(repoFullName, acceptedCandidates));

  const tokenCount = estimateTokenCount(body);

  async function submit() {
    await create.mutateAsync({
      name: name.trim() || defaultSkillName(repoFullName),
      description,
      type,
      source: "extracted",
      body,
      enabled,
      evidence_files: [...new Set(acceptedCandidates.map((c) => c.evidence_path))],
    });
    onClose();
  }

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("modal.title")}
      subtitle={name}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Sparkles"
            onClick={submit}
            disabled={create.isPending || !body.trim() || !name.trim()}
          >
            {create.isPending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.banner}>
          <Icon.Link size={14} style={{ marginTop: 2, flexShrink: 0 }} />
          <span>{t("modal.banner", { count: acceptedCandidates.length, repo: repoFullName })}</span>
        </div>

        <FormField label={t("modal.fields.name")} required>
          <TextInput value={name} onChange={setName} />
        </FormField>
        <FormField label={t("modal.fields.description")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>
        <FormField label={t("modal.fields.type")}>
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={[...TYPE_VALUES]} />
        </FormField>
        <div style={s.enabledRow}>
          <div>
            <div style={s.enabledLabel}>{t("modal.fields.enabled")}</div>
            <div style={s.enabledHint}>{t("modal.fields.enabledHint")}</div>
          </div>
          <Toggle on={enabled} onChange={setEnabled} />
        </div>
        <FormField
          label={t("modal.fields.body")}
          required
          right={<span style={s.tokenCount}>{t("modal.tokenCount", { count: tokenCount })}</span>}
        >
          <Textarea value={body} onChange={setBody} rows={14} mono />
        </FormField>
      </div>
    </Modal>
  );
}
