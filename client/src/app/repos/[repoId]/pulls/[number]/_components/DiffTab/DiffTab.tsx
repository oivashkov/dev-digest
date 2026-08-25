"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "../SmartDiffViewer";
// `index.ts`'s barrel only exports the component, not this type (out of this
// step's Owned paths) — import the type straight from the source file, the
// same barrel-bypass pattern `FindingsTab.tsx` already uses for `RunHistory`.
import type { ScrollTarget } from "../SmartDiffViewer/SmartDiffViewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { s } from "./styles";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Passed through to SmartDiffViewer's inline FindingCard for its
   *  file:line deep-link (same props FindingsTab already threads). */
  repoFullName?: string | null;
  repoProvider?: "github" | "gitlab";
  repoHost?: string;
  headSha?: string | null;
  /** Set by `PrDetailView` when a `review_focus[]` item is clicked on the
   *  Overview tab. Forces `order` to `"smart"` — the `"original"` order
   *  renders plain `DiffViewer`, which has no scroll props at all, so a jump
   *  would silently no-op there — and forwards the target to
   *  `SmartDiffViewer`. */
  focusTarget?: ScrollTarget | null;
}

type DiffOrder = "smart" | "original";

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  repoFullName,
  repoProvider,
  repoHost,
  headSha,
  focusTarget,
}: DiffTabProps) {
  const t = useTranslations("smartDiff");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Smart order is the default; SmartDiffViewer itself falls back to plain
  // Original order while loading/on error (graceful, per the plan).
  const [order, setOrder] = React.useState<DiffOrder>("smart");
  // A pending focus target always wins over the user's own toggle — the
  // "original" order has no scroll props (see DiffViewer.tsx), so it cannot
  // honor a jump at all. Derived, not stored: no effect needed.
  const effectiveOrder: DiffOrder = focusTarget ? "smart" : order;

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={s.toggleRow}>
            <div style={s.toggleGroup}>
              <Button
                kind="tertiary"
                size="sm"
                active={effectiveOrder === "smart"}
                onClick={() => setOrder("smart")}
              >
                {t("toggle.smart")}
              </Button>
              <Button
                kind="tertiary"
                size="sm"
                active={effectiveOrder === "original"}
                onClick={() => setOrder("original")}
              >
                {t("toggle.original")}
              </Button>
            </div>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {effectiveOrder === "smart" ? (
        <SmartDiffViewer
          prId={prId}
          files={files}
          commenting={commenting}
          repoFullName={repoFullName}
          repoProvider={repoProvider}
          repoHost={repoHost}
          headSha={headSha}
          externalTarget={focusTarget}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
