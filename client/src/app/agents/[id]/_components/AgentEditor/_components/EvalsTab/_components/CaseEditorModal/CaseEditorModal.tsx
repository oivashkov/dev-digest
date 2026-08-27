/* CaseEditorModal — create/edit an eval case (SPEC-04 ACs 3-4, 74-79). Name,
   a three-tab input strip (Diff/Files/PR meta, AC 77), a raw-JSON
   expected-output textarea (invalid-JSON state disables Save, AC 74), the
   finding-skeleton insert helper (AC 75), a Run-on-save toggle (AC 76 — the
   deliberate exception to this app's auto-save-on-click model, per
   `client/INSIGHTS.md` 2026-08-12), and a non-blocking out-of-hunk warning
   computed at save time (AC 78-79; see helpers.ts's DEVIATION note on why
   that check is a small local reimplementation rather than an import from
   `reviewer-core`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Modal, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { Agent, EvalCase, EvalRunRecord } from "@devdigest/shared";
import { useCreateEvalCase, useRunEvalCase, useUpdateEvalCase } from "@/lib/hooks/evals";
import { useToast } from "@/lib/toast";
import { INPUT_TABS, JSON_INDENT, MODAL_WIDTH, SKELETON_EXPECTATION, type InputTab } from "./constants";
import {
  filesToText,
  findOutOfHunkExpectations,
  mergeInputMeta,
  parseExpectedOutput,
  parseFilesText,
  type OutOfHunkWarning,
} from "./helpers";
import { s } from "./styles";

function metaField(meta: unknown, key: "title" | "body"): string {
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const v = (meta as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  return "";
}

export function CaseEditorModal({
  agent,
  case_,
  lastRun,
  onClose,
}: {
  agent: Agent;
  case_: EvalCase | null;
  /** This case's most recent `eval_runs` row, if any — looked up by the
   *  caller (EvalsTab already has `recent_runs` loaded for the case list). */
  lastRun?: EvalRunRecord | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const toast = useToast();
  const create = useCreateEvalCase(agent.id);
  const update = useUpdateEvalCase(agent.id);
  const runCase = useRunEvalCase(agent.id);

  const [name, setName] = React.useState(case_?.name ?? "");
  const [diffText, setDiffText] = React.useState(case_?.input_diff ?? "");
  const [filesText, setFilesText] = React.useState(filesToText(case_?.input_files));
  const [prTitle, setPrTitle] = React.useState(metaField(case_?.input_meta, "title"));
  const [prBody, setPrBody] = React.useState(metaField(case_?.input_meta, "body"));
  const [expectedText, setExpectedText] = React.useState(
    JSON.stringify(case_?.expected_output ?? [], null, JSON_INDENT),
  );
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<InputTab>("diff");
  const [warnings, setWarnings] = React.useState<OutOfHunkWarning[]>([]);

  const { valid: jsonValid, value: expectations } = parseExpectedOutput(expectedText);
  const saving = create.isPending || update.isPending || runCase.isPending;
  const canSave = jsonValid && name.trim().length > 0 && !saving;

  const insertSkeleton = () => {
    const { value } = parseExpectedOutput(expectedText);
    setExpectedText(JSON.stringify([...value, SKELETON_EXPECTATION], null, JSON_INDENT));
  };

  const save = async () => {
    if (!canSave) return;
    setWarnings(findOutOfHunkExpectations(diffText, expectations));
    const input = {
      owner_kind: "agent" as const,
      owner_id: agent.id,
      name: name.trim(),
      input_diff: diffText,
      input_files: parseFilesText(filesText),
      input_meta: mergeInputMeta(case_?.input_meta, prTitle, prBody),
      expected_output: expectations,
      notes: case_?.notes ?? null,
    };
    const saved = case_
      ? await update.mutateAsync({ id: case_.id, input })
      : await create.mutateAsync(input);
    toast.success(t("caseEditor.save"));
    if (runOnSave) await runCase.mutateAsync(saved.id);
    onClose();
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={case_ ? t("caseEditor.caseTitle", { name: case_.name }) : t("caseEditor.newCase")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <label style={s.runOnSaveRow}>
            <Toggle on={runOnSave} onChange={setRunOnSave} size={14} />
            <span style={{ fontSize: 13 }}>{t("caseEditor.runOnSave")}</span>
          </label>
          <div style={{ marginLeft: "auto" }}>
            <Button kind="primary" icon="Check" onClick={save} disabled={!canSave}>
              {saving ? t("caseEditor.saving") : t("caseEditor.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("caseEditor.nameLabel")} required>
          <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
        </FormField>

        <FormField label={t("caseEditor.inputLabel")} hint={activeTab === "files" ? t("caseEditor.filesHint") : undefined}>
          <div style={s.tabStrip}>
            {INPUT_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                style={s.tabBtn(activeTab === tab)}
                onClick={() => setActiveTab(tab)}
              >
                {t(`caseEditor.tabs.${tab}`)}
              </button>
            ))}
          </div>
          {activeTab === "diff" && (
            <Textarea value={diffText} onChange={setDiffText} rows={10} mono placeholder={t("caseEditor.diffPlaceholder")} />
          )}
          {activeTab === "files" && <Textarea value={filesText} onChange={setFilesText} rows={6} mono />}
          {activeTab === "prMeta" && (
            <>
              <FormField label={t("caseEditor.titleLabel")}>
                <TextInput value={prTitle} onChange={setPrTitle} placeholder={t("caseEditor.titlePlaceholder")} />
              </FormField>
              <FormField label={t("caseEditor.bodyLabel")}>
                <Textarea value={prBody} onChange={setPrBody} rows={4} placeholder={t("caseEditor.bodyPlaceholder")} />
              </FormField>
            </>
          )}
        </FormField>

        <FormField
          label={t("caseEditor.expectedOutput")}
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge color={jsonValid ? "var(--ok)" : "var(--crit)"} bg={jsonValid ? "var(--ok-bg)" : "var(--crit-bg)"}>
                {jsonValid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
              </Badge>
              <Button kind="ghost" size="sm" icon="Plus" onClick={insertSkeleton}>
                {t("caseEditor.insertSkeleton")}
              </Button>
            </div>
          }
        >
          <Textarea value={expectedText} onChange={setExpectedText} rows={10} mono />
        </FormField>

        {warnings.length > 0 && (
          <div style={s.warningBox}>
            {warnings.map((w, i) => (
              <div key={i}>{t("caseEditor.outOfHunkWarning", { file: w.file, line: w.line })}</div>
            ))}
          </div>
        )}

        {lastRun && lastRun.recall != null && lastRun.precision != null && lastRun.citation_accuracy != null && (
          <p style={s.lastRunNote}>
            {lastRun.pass ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}
            {" — "}
            {t("caseEditor.resultSummary", {
              recall: Math.round(lastRun.recall * 100),
              precision: Math.round(lastRun.precision * 100),
              citation: Math.round(lastRun.citation_accuracy * 100),
              duration: ((lastRun.duration_ms ?? 0) / 1000).toFixed(1),
            })}
          </p>
        )}
      </div>
    </Modal>
  );
}
