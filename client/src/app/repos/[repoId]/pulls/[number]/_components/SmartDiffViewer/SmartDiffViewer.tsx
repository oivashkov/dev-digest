/* SmartDiffViewer — "Files changed" content sorted by review risk instead of
   GitHub's original order: core (business logic) -> wiring (entry points/
   config) -> boilerplate (lockfiles, generated code, i18n), so the
   substantive diff sits above the noise. Classification and finding-line
   anchors come from `GET /pulls/:id/smart-diff` (`useSmartDiff`) — a
   deterministic, LLM-free computation (`docs/plans/smart-diff.md`). Reuses
   `FileCard` for per-file rendering so inline comments keep working
   unchanged in Smart order. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { DiffViewer, FileCard, type DiffCommentApi } from "@/components/diff-viewer";
import { useSmartDiff } from "@/lib/hooks/reviews";
import type { PrFile, SmartDiffRole } from "@devdigest/shared";
import { s } from "./styles";
import { GROUP_ORDER } from "./constants";

/** Scroll-to-line target for a click on a file's findings affordance — same
 *  target/nonce pattern as `FindingsTab.tsx`, keyed by file path since
 *  multiple files across groups can each have their own findings. */
interface ScrollTarget {
  path: string;
  line: number;
  n: number;
}

export function SmartDiffViewer({
  prId,
  files,
  commenting,
}: {
  prId: string | null;
  /** Source of each file's `patch` text — SmartDiff's own file entries carry
   *  only `path`/`additions`/`deletions`/`finding_lines`, not the diff body. */
  files: PrFile[];
  commenting?: DiffCommentApi;
}) {
  const t = useTranslations("smartDiff");
  const { data, isLoading, isError } = useSmartDiff(prId);
  const [target, setTarget] = React.useState<ScrollTarget | null>(null);

  const fileByPath = React.useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);

  const handleJump = React.useCallback((path: string, lines: number[]) => {
    if (lines.length === 0) return;
    const line = Math.min(...lines);
    setTarget((prev) => ({ path, line, n: (prev?.n ?? 0) + 1 }));
  }, []);

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
          commenting={commenting}
          target={target}
          onJump={handleJump}
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
  commenting,
  target,
  onJump,
  t,
}: {
  role: SmartDiffRole;
  files: { path: string; additions: number; deletions: number; finding_lines: number[] }[];
  fileByPath: Map<string, PrFile>;
  commenting?: DiffCommentApi;
  target: ScrollTarget | null;
  onJump: (path: string, lines: number[]) => void;
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
          const hasFindings = f.finding_lines.length > 0;
          // core/wiring always default open; boilerplate only when it has
          // findings — findings must never stay hidden, even in boilerplate.
          const defaultOpen = role !== "boilerplate" || hasFindings;
          const isTarget = target?.path === f.path;
          return (
            <div key={f.path} style={s.fileRow}>
              {hasFindings && (
                <button
                  type="button"
                  style={s.jumpButton}
                  onClick={() => onJump(f.path, f.finding_lines)}
                  aria-label={t("jumpAriaLabel", { path: f.path })}
                >
                  <Icon.AlertOctagon size={12} />
                  {t("findingsCount", { count: f.finding_lines.length })}
                </button>
              )}
              <FileCard
                file={patchFile}
                commenting={commenting}
                defaultOpen={defaultOpen}
                highlightLines={f.finding_lines}
                findingCount={f.finding_lines.length}
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
