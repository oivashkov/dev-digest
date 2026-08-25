/* /repos/:repoId/context — Project Context page (SPEC-01). Read-only browse +
   preview + refresh of the Markdown documents discovered under the repo's
   clone (specs/, docs/, INSIGHTS.md). No create/upload/edit affordance —
   attaching a document to an agent or skill happens on their own editors'
   Context tab/section (Step 7), not here. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { SafeMarkdown } from "@/components/safe-markdown";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useContextFile, useContextFiles, useReindexContext } from "@/lib/hooks";
import { formatTokenCount } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { SKELETON_ROWS } from "./constants";
import { filterDocuments, relativeTime, typeBadgeStyle } from "./helpers";
import { s } from "./styles";

export function ProjectContextView() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, error, refetch } = useContextFiles(repoId);
  const reindex = useReindexContext();
  const [filter, setFilter] = React.useState("");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  const documents = data?.documents ?? [];
  const visible = filterDocuments(documents, filter);
  const { data: previewDoc, isLoading: previewLoading, isError: previewError } = useContextFile(
    repoId,
    selectedPath,
  );

  const repoName = activeRepo?.full_name ?? repoId;

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: t("title") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: t("title") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {t("title")}
              <span className="mono" style={s.repoName}>
                {" "}
                {repoName}
              </span>
            </h1>
            <p style={s.subtitle}>{t("subtitle")}</p>
          </div>
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={reindex.isPending}
            disabled={reindex.isPending || !repoId}
            onClick={() => repoId && reindex.mutate(repoId)}
          >
            {reindex.isPending ? t("reindexing") : t("reindex")}
          </Button>
        </div>

        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={60} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("loadError")}
            body={error instanceof ApiError ? error.message : undefined}
            onRetry={() => refetch()}
          />
        ) : documents.length === 0 ? (
          <EmptyState
            icon="FileText"
            title={t("empty.title")}
            body={t("empty.body")}
            cta={t("empty.cta")}
            onCta={() => repoId && reindex.mutate(repoId)}
            ctaLoading={reindex.isPending}
          />
        ) : (
          <>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("list.filterPlaceholder")}
              style={s.filterInput}
              aria-label={t("list.filterPlaceholder")}
            />
            <div style={s.body}>
              <div style={s.listCard}>
                {visible.length === 0 ? (
                  <div style={s.listEmpty}>{t("list.empty")}</div>
                ) : (
                  visible.map((doc) => {
                    const tb = typeBadgeStyle(doc.type);
                    return (
                      <div
                        key={doc.path}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedPath(doc.path)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") setSelectedPath(doc.path);
                        }}
                        style={s.listRow(selectedPath === doc.path)}
                      >
                        <div style={s.rowTop}>
                          <Badge color={tb.color} bg={tb.bg} style={s.typeBadge}>
                            {t(`type.${doc.type}`)}
                          </Badge>
                          <span className="mono" style={s.rowPath}>
                            {doc.path}
                          </span>
                        </div>
                        <span style={s.rowMeta}>
                          {formatTokenCount(doc.tokens)} tok
                          {doc.size != null ? ` · ${doc.size}b` : ""}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              <div style={s.previewCard}>
                {!selectedPath ? (
                  <span style={s.previewHint}>{t("preview.selectHint")}</span>
                ) : previewLoading ? (
                  <Skeleton height={200} />
                ) : previewError || !previewDoc ? (
                  <ErrorState title={t("preview.loadError")} />
                ) : (
                  <>
                    <div className="mono" style={s.previewPath}>
                      {previewDoc.path}
                    </div>
                    <SafeMarkdown>{previewDoc.content}</SafeMarkdown>
                  </>
                )}
              </div>
            </div>

            <div style={s.footer}>
              <span>
                {t("footer", {
                  count: documents.length,
                  tokens: formatTokenCount(data?.tokens_total ?? 0),
                  time: data?.last_scan_at ? relativeTime(data.last_scan_at) : "—",
                })}
              </span>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
