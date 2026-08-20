/* SmartDiffViewer — "Files changed" content sorted by review risk instead of
   GitHub's original order: core (business logic) -> wiring (entry points/
   config) -> boilerplate (lockfiles, generated code, i18n), so the
   substantive diff sits above the noise. Classification and finding-line
   anchors come from `GET /pulls/:id/smart-diff` (`useSmartDiff`) — a
   deterministic, LLM-free computation (`docs/plans/smart-diff.md`). Reuses
   `FileCard` for per-file rendering so inline comments keep working
   unchanged in Smart order.

   Each file's findings render as one compact severity badge per finding
   (not a single aggregate count) — clicking a badge scrolls the diff to that
   finding's line AND opens its full `FindingCard` (severity, rationale,
   accept/dismiss) right there, reusing the same card the Findings tab uses
   instead of a stripped-down summary. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SeverityBadge, type Severity } from "@devdigest/ui";
import { DiffViewer, FileCard, type DiffCommentApi } from "@/components/diff-viewer";
import { useSmartDiff, usePrReviews, useFindingAction } from "@/lib/hooks/reviews";
import { FindingCard } from "../FindingCard";
import type { FindingActionKind, FindingRecord, PrFile, SmartDiffRole } from "@devdigest/shared";
import { s } from "./styles";
import { GROUP_ORDER } from "./constants";

/** Scroll-to-line target for a click on a finding badge — same target/nonce
 *  pattern as `FindingsTab.tsx`, keyed by file path since multiple files
 *  across groups can each have their own findings. */
interface ScrollTarget {
  path: string;
  line: number;
  n: number;
}

export function SmartDiffViewer({
  prId,
  files,
  commenting,
  repoFullName,
  repoProvider,
  repoHost,
  headSha,
}: {
  prId: string | null;
  /** Source of each file's `patch` text — SmartDiff's own file entries carry
   *  only `path`/`additions`/`deletions`/`finding_lines`, not the diff body. */
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** Passed through to the inline `FindingCard` for its file:line deep-link. */
  repoFullName?: string | null;
  repoProvider?: "github" | "gitlab";
  repoHost?: string;
  headSha?: string | null;
}) {
  const t = useTranslations("smartDiff");
  const { data, isLoading, isError } = useSmartDiff(prId);
  const { data: reviews } = usePrReviews(prId);
  const action = useFindingAction();
  const [target, setTarget] = React.useState<ScrollTarget | null>(null);
  const [openFindingId, setOpenFindingId] = React.useState<string | null>(null);

  const fileByPath = React.useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);

  // Per-file, non-dismissed findings from the PR's latest review — the same
  // "latest review, non-dismissed" source the server uses to build
  // `finding_lines` (`server/src/modules/reviews/smart-diff.ts` +
  // `service.ts#getSmartDiff`), but keeping each individual Finding (id,
  // severity, rationale) instead of collapsing to bare line numbers, so the
  // diff can render one severity badge per finding and open its real card.
  const findingsByPath = React.useMemo(() => {
    const latest = reviews?.[0]?.findings ?? [];
    const map = new Map<string, FindingRecord[]>();
    for (const f of latest) {
      if (f.dismissed_at != null) continue;
      const list = map.get(f.file);
      if (list) list.push(f);
      else map.set(f.file, [f]);
    }
    for (const list of map.values()) list.sort((a, b) => a.start_line - b.start_line);
    return map;
  }, [reviews]);

  const handleFindingClick = React.useCallback((path: string, finding: FindingRecord) => {
    setTarget((prev) => ({ path, line: finding.start_line, n: (prev?.n ?? 0) + 1 }));
    setOpenFindingId((prev) => (prev === finding.id ? null : finding.id));
  }, []);

  const handleFindingAction = React.useCallback(
    (findingId: string, act: FindingActionKind) => {
      action.mutate({ findingId, action: act, prId: prId ?? undefined });
    },
    [action, prId],
  );

  // Graceful fallback: while SmartDiff is loading, failed to load, or came
  // back with nothing to group, render the plain original-order DiffViewer
  // rather than an error/empty screen (per decision 5 in the plan).
  const groups = React.useMemo(() => {
    if (!data) return [];
    const byRole = new Map(data.groups.map((g) => [g.role, g]));
    return GROUP_ORDER.map((role) => byRole.get(role)).filter(
      (g): g is NonNullable<typeof g> => !!g && g.files.length > 0,
    );
  }, [data]);

  if (isLoading || isError || !data || groups.length === 0) {
    return <DiffViewer files={files} commenting={commenting} />;
  }

  return (
    <div style={s.list}>
      {groups.map((group) => (
        <SmartDiffGroupSection
          key={group.role}
          role={group.role}
          files={group.files}
          fileByPath={fileByPath}
          findingsByPath={findingsByPath}
          commenting={commenting}
          target={target}
          openFindingId={openFindingId}
          onFindingClick={handleFindingClick}
          onFindingAction={handleFindingAction}
          actionPending={action.isPending}
          repoFullName={repoFullName}
          repoProvider={repoProvider}
          repoHost={repoHost}
          headSha={headSha}
          t={t}
        />
      ))}
    </div>
  );
}

function SmartDiffGroupSection({
  role,
  files,
  fileByPath,
  findingsByPath,
  commenting,
  target,
  openFindingId,
  onFindingClick,
  onFindingAction,
  actionPending,
  repoFullName,
  repoProvider,
  repoHost,
  headSha,
  t,
}: {
  role: SmartDiffRole;
  files: { path: string; additions: number; deletions: number; finding_lines: number[] }[];
  fileByPath: Map<string, PrFile>;
  findingsByPath: Map<string, FindingRecord[]>;
  commenting?: DiffCommentApi;
  target: ScrollTarget | null;
  openFindingId: string | null;
  onFindingClick: (path: string, finding: FindingRecord) => void;
  onFindingAction: (findingId: string, action: FindingActionKind) => void;
  actionPending: boolean;
  repoFullName?: string | null;
  repoProvider?: "github" | "gitlab";
  repoHost?: string;
  headSha?: string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div style={s.group}>
      <div style={s.groupHeader}>
        <span style={s.groupLabel}>{t(`groups.${role}.label`)}</span>
        <span style={s.groupDescription}>{t(`groups.${role}.description`)}</span>
      </div>
      <div style={s.groupFiles}>
        {files.map((f) => {
          const patchFile = fileByPath.get(f.path);
          if (!patchFile) return null;
          const fileFindings = findingsByPath.get(f.path) ?? [];
          const hasFindings = fileFindings.length > 0;
          // core/wiring always default open; boilerplate only when it has
          // findings — findings must never stay hidden, even in boilerplate.
          const defaultOpen = role !== "boilerplate" || hasFindings;
          const isTarget = target?.path === f.path;
          const openFinding = fileFindings.find((finding) => finding.id === openFindingId);
          return (
            <div key={f.path} style={s.fileRow}>
              {hasFindings && (
                <div style={s.findingBadgeRow}>
                  {fileFindings.map((finding) => (
                    <button
                      key={finding.id}
                      type="button"
                      style={s.findingBadgeButton}
                      onClick={() => onFindingClick(f.path, finding)}
                      aria-label={t("findingBadgeAriaLabel", { title: finding.title })}
                    >
                      <SeverityBadge severity={finding.severity as Severity} compact />
                    </button>
                  ))}
                </div>
              )}
              {openFinding && (
                <FindingCard
                  key={openFinding.id}
                  f={openFinding}
                  defaultExpanded
                  pending={actionPending}
                  repoFullName={repoFullName}
                  repoProvider={repoProvider}
                  repoHost={repoHost}
                  headSha={headSha}
                  onAction={(act) => onFindingAction(openFinding.id, act)}
                />
              )}
              <FileCard
                file={patchFile}
                commenting={commenting}
                defaultOpen={defaultOpen}
                highlightLines={f.finding_lines}
                findingCount={fileFindings.length}
                scrollToLine={isTarget ? target.line : undefined}
                scrollNonce={isTarget ? target.n : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
