/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { useCreateEvalCaseFromFinding } from "@/lib/hooks/evals";
import { notify } from "@/lib/toast";
import {
  SEV_COLOR,
  SEV_COLOR_FALLBACK,
  TURN_INTO_EVAL_CASE_DISABLED_TITLE,
  TURN_INTO_EVAL_CASE_DONE_TITLE,
  TURN_INTO_EVAL_CASE_ERROR_FALLBACK,
} from "./constants";
import { lineLabel } from "./helpers";
import { vcsBlobUrl } from "../../../../../../../lib/vcs-urls";
import { s } from "./styles";

/* "Turn into eval case" (SPEC-04 ACs 8-18) is its own child component, not
   inline in FindingCard's body, and is mounted only inside the `expanded`
   action row below — this keeps `useCreateEvalCaseFromFinding`'s
   `useQueryClient()` call from running for every collapsed card in a list
   (most of them, on a findings-heavy PR), and confines "does this render
   tree have a QueryClientProvider ancestor" to only the cards a reviewer has
   actually opened, rather than the widest possible surface. Calls the Step 7
   hook directly rather than widening `onAction` — `FindingActionKind` is a
   shared contract whose `learn`/`reply` members `actOnFinding` rejects, and
   this action targets a different endpoint
   (`POST /findings/:id/eval-case`, owned by evals/routes.ts) that must not
   be smuggled into that enum. No `agentId` is threaded through this
   presentational tree, so the eval-cases cache invalidation the hook offers
   is simply skipped here — this page has no eval-case list to keep in
   sync. */
function TurnIntoEvalCaseButton({
  findingId,
  muted,
  pending,
}: {
  findingId: string;
  muted: boolean;
  pending?: boolean;
}) {
  const t = useTranslations("prReview");
  const createEvalCase = useCreateEvalCaseFromFinding(undefined);
  const evalCaseCreated = createEvalCase.isSuccess;
  const evalCaseDisabled = pending || createEvalCase.isPending || evalCaseCreated || !muted;
  // Server mirrors this with a 400 (AC 17) when neither accepted_at nor
  // dismissed_at is set — the client disables the control for the same
  // reason instead of letting the request round-trip to fail.
  const evalCaseTitle = evalCaseCreated
    ? TURN_INTO_EVAL_CASE_DONE_TITLE
    : !muted
      ? TURN_INTO_EVAL_CASE_DISABLED_TITLE
      : undefined;

  return (
    <Button
      kind="ghost"
      size="sm"
      icon={evalCaseCreated ? "Check" : "FlaskConical"}
      disabled={evalCaseDisabled}
      loading={createEvalCase.isPending}
      title={evalCaseTitle}
      onClick={() =>
        createEvalCase.mutate(findingId, {
          onError: (err) =>
            notify.error(err instanceof Error ? err.message : TURN_INTO_EVAL_CASE_ERROR_FALLBACK),
        })
      }
    >
      {t("finding.turnIntoEvalCase")}
    </Button>
  );
}

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  repoProvider = "github",
  repoHost = "github.com",
  headSha,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  repoProvider?: "github" | "gitlab";
  repoHost?: string;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? vcsBlobUrl(repoFullName, headSha, f.file, repoProvider, repoHost, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            <TurnIntoEvalCaseButton findingId={f.id} muted={muted} pending={pending} />
          </div>
        </div>
      )}
    </div>
  );
}
