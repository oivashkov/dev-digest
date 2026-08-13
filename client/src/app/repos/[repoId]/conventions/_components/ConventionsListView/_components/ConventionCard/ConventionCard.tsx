"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, IconBtn, MonoLink, PercentProgress, TextInput, Textarea } from "@devdigest/ui";
import type { ConventionCandidate, RepoProvider, UpdateConventionCandidate } from "@devdigest/shared";
import { vcsBlobUrl } from "@/lib/vcs-urls";
import { CATEGORY_ICON } from "./constants";
import { parseLineRange } from "./helpers";
import { s } from "./styles";

/** One convention candidate — rule, evidence (code + file:line link),
 *  confidence, accept/reject, and inline edit. Accept/reject/edit all persist
 *  immediately via `onUpdate` (no batch save — see client/INSIGHTS.md). */
export function ConventionCard({
  candidate,
  repoFullName,
  defaultBranch,
  repoProvider = "github",
  repoHost = "github.com",
  pending,
  onUpdate,
}: {
  candidate: ConventionCandidate;
  repoFullName?: string | null;
  defaultBranch?: string | null;
  repoProvider?: RepoProvider;
  repoHost?: string;
  pending?: boolean;
  onUpdate: (patch: UpdateConventionCandidate) => void;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(candidate.rule);
  const [snippet, setSnippet] = React.useState(candidate.evidence_snippet);

  const { start, end } = parseLineRange(candidate.evidence_line_range);
  const fileHref =
    repoFullName && defaultBranch
      ? vcsBlobUrl(repoFullName, defaultBranch, candidate.evidence_path, repoProvider, repoHost, start, end)
      : undefined;

  function startEdit() {
    setRule(candidate.rule);
    setSnippet(candidate.evidence_snippet);
    setEditing(true);
  }

  function saveEdit() {
    onUpdate({ rule, evidence_snippet: snippet });
    setEditing(false);
  }

  return (
    <div style={s.card(candidate.accepted)}>
      <div style={s.titleRow}>
        <div style={s.titleMain}>
          <div style={s.title}>{candidate.rule}</div>
        </div>
        <Badge icon={CATEGORY_ICON[candidate.category]}>{t(`card.categoryLabel.${candidate.category}`)}</Badge>
        <div style={s.editBtn}>
          <IconBtn icon="Edit" label={t("card.edit")} onClick={startEdit} />
        </div>
      </div>

      {editing ? (
        <div style={s.editForm}>
          <TextInput value={rule} onChange={setRule} />
          <Textarea value={snippet} onChange={setSnippet} rows={4} mono />
          <div style={s.editActions}>
            <Button kind="primary" size="sm" onClick={saveEdit} disabled={pending}>
              {t("card.save")}
            </Button>
            <Button kind="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}>
              {t("card.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div style={s.evidence}>
          <div style={s.evidenceHeader}>
            <MonoLink href={fileHref}>
              {candidate.evidence_path}
              {candidate.evidence_line_range ? `:${candidate.evidence_line_range}` : ""}
            </MonoLink>
          </div>
          <pre style={s.evidenceCode}>{candidate.evidence_snippet}</pre>
        </div>
      )}

      <PercentProgress value={candidate.confidence * 100} label={t("card.confidence")} />

      <div style={s.actions}>
        <Button
          kind="secondary"
          size="sm"
          icon="Check"
          disabled={pending}
          active={candidate.accepted}
          onClick={() => onUpdate({ accepted: true })}
        >
          {t("card.accepted")}
        </Button>
        {/* `accepted` is a plain boolean (no tri-state for "never reviewed" vs
            "explicitly rejected"), so Reject has no active/highlighted state —
            only Accept does. Clicking Reject on an already-rejected candidate
            is a harmless no-op PATCH. */}
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          disabled={pending}
          onClick={() => onUpdate({ accepted: false })}
        >
          {t("card.reject")}
        </Button>
      </div>
    </div>
  );
}
