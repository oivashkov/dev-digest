/* CompareRunsModal — side-by-side metric deltas (AC 49), a system-prompt
   diff when the two runs' recorded agent_version differ (AC 50) or an
   explicit "identical configuration" message when they don't (AC 51), and a
   per-side Promote control enabled only when that side's version differs
   from the agent's current live version (ACs 54-59). `left`/`right` are
   persisted `PersistedRunEntry` values grouped from the agent dashboard's
   `recent_runs` (EvalsTab/helpers.ts) — real, server-sourced history, not
   the session-scoped in-memory list this modal used to take (see
   `client/INSIGHTS.md`, 2026-08-27 Decision). Neither entry carries the
   actual prompt TEXT (only `agentVersion`, a number) — this modal fetches
   each side's `config.system_prompt` itself via `useAgentVersion`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentVersion, useRestoreAgentVersion } from "@/lib/hooks/agents";
import { useToast } from "@/lib/toast";
import { formatCostUsd } from "@/lib/format";
import type { PersistedRunEntry } from "../../helpers";
import { formatPct } from "../../helpers";
import { diffLines, signedCostDelta, signedPctDelta } from "./helpers";
import { s } from "./styles";

export function CompareRunsModal({
  agent,
  left,
  right,
  onClose,
}: {
  agent: Agent;
  left: PersistedRunEntry;
  right: PersistedRunEntry;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const toast = useToast();
  const restore = useRestoreAgentVersion();
  const leftVersion = useAgentVersion(agent.id, left.agentVersion);
  const rightVersion = useAgentVersion(agent.id, right.agentVersion);

  const promptsUnknown = left.agentVersion == null || right.agentVersion == null;
  const sameVersion = !promptsUnknown && left.agentVersion === right.agentVersion;
  const promptsLoading = !promptsUnknown && (leftVersion.isLoading || rightVersion.isLoading);
  const lines = React.useMemo(
    () =>
      sameVersion || promptsUnknown || !leftVersion.data || !rightVersion.data
        ? []
        : diffLines(leftVersion.data.config.system_prompt, rightVersion.data.config.system_prompt),
    [sameVersion, promptsUnknown, leftVersion.data, rightVersion.data],
  );

  const promote = (version: number) => {
    if (!window.confirm(t("compare.confirmPromote", { version }))) return;
    restore.mutate(
      { agentId: agent.id, version },
      { onSuccess: (data) => toast.success(t("compare.promote", { version: data.version })) },
    );
  };

  return (
    <Modal title={t("compare.title")} onClose={onClose} width={720}>
      <div style={s.body}>
        <table style={s.metricsTable}>
          <thead>
            <tr>
              <th style={s.th}></th>
              <th style={s.th}>{t("compare.versionLabel", { version: left.agentVersion ?? "?" })}</th>
              <th style={s.th}>{t("compare.versionLabel", { version: right.agentVersion ?? "?" })}</th>
              <th style={s.th}>Δ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={s.td}>{t("compare.recall")}</td>
              <td style={s.tdMono}>{formatPct(left.result.recall)}</td>
              <td style={s.tdMono}>{formatPct(right.result.recall)}</td>
              <td style={s.tdMono}>{signedPctDelta(left.result.recall, right.result.recall)}</td>
            </tr>
            <tr>
              <td style={s.td}>{t("compare.precision")}</td>
              <td style={s.tdMono}>{formatPct(left.result.precision)}</td>
              <td style={s.tdMono}>{formatPct(right.result.precision)}</td>
              <td style={s.tdMono}>{signedPctDelta(left.result.precision, right.result.precision)}</td>
            </tr>
            <tr>
              <td style={s.td}>{t("compare.citationAccuracy")}</td>
              <td style={s.tdMono}>{formatPct(left.result.citation_accuracy)}</td>
              <td style={s.tdMono}>{formatPct(right.result.citation_accuracy)}</td>
              <td style={s.tdMono}>{signedPctDelta(left.result.citation_accuracy, right.result.citation_accuracy)}</td>
            </tr>
            <tr>
              <td style={s.td}>{t("compare.cost")}</td>
              <td style={s.tdMono}>{formatCostUsd(left.result.cost_usd)}</td>
              <td style={s.tdMono}>{formatCostUsd(right.result.cost_usd)}</td>
              <td style={s.tdMono}>{signedCostDelta(left.result.cost_usd, right.result.cost_usd)}</td>
            </tr>
          </tbody>
        </table>

        <div style={s.promptSection}>
          <div style={s.sectionTitle}>{t("compare.promptDiffTitle")}</div>
          {promptsUnknown ? (
            <p style={s.identicalNote}>{t("compare.versionUnknown")}</p>
          ) : promptsLoading ? (
            <Skeleton height={80} />
          ) : sameVersion ? (
            <p style={s.identicalNote}>{t("compare.samePromptConfig")}</p>
          ) : (
            <div style={s.diffBox}>
              {lines.map((line, i) => (
                <div key={i} style={s.diffLine(line.type)}>
                  {line.text}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={s.promoteRow}>
          <div>
            <Button
              kind="secondary"
              icon="History"
              disabled={left.agentVersion == null || left.agentVersion === agent.version || restore.isPending}
              onClick={() => promote(left.agentVersion!)}
            >
              {restore.isPending
                ? t("compare.promoting")
                : t("compare.promote", { version: left.agentVersion ?? "?" })}
            </Button>
          </div>
          <div>
            <Button
              kind="secondary"
              icon="History"
              disabled={right.agentVersion == null || right.agentVersion === agent.version || restore.isPending}
              onClick={() => promote(right.agentVersion!)}
            >
              {restore.isPending
                ? t("compare.promoting")
                : t("compare.promote", { version: right.agentVersion ?? "?" })}
            </Button>
          </div>
        </div>
        <p style={s.promoteHint}>{t("compare.promoteHint")}</p>
      </div>
    </Modal>
  );
}
