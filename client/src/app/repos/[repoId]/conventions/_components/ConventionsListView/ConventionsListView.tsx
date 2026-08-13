/* /repos/:repoId/conventions — Conventions Lab list. Scan the repo, review
   candidates (accept/reject/edit persist immediately — see ConventionCard),
   then merge the accepted ones into a Skill via CreateSkillFromConventionsModal. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useConventionsState, useTriggerConventionsExtraction, useUpdateConvention } from "@/lib/hooks/conventions";
import { ApiError } from "@/lib/api";
import { ConventionCard } from "./_components/ConventionCard";
import { CreateSkillFromConventionsModal } from "./_components/CreateSkillFromConventionsModal";
import { countAccepted, relativeTime } from "./helpers";
import { s } from "./styles";

const SKELETON_ROWS = 3;

export function ConventionsListView() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  // `poll` mirrors the last-seen scan_status — flips the query's own
  // refetchInterval on once a scan starts, off once it leaves "scanning".
  const [poll, setPoll] = React.useState(false);
  const { data: state, isLoading, isError, error, refetch } = useConventionsState(repoId, poll);
  React.useEffect(() => {
    setPoll(state?.scan_status === "scanning");
  }, [state?.scan_status]);
  const scanning = state?.scan_status === "scanning";

  const extract = useTriggerConventionsExtraction(repoId);
  const update = useUpdateConvention(repoId);
  const [creatingSkill, setCreatingSkill] = React.useState(false);

  const repoName = activeRepo?.full_name ?? repoId;
  const candidates = state?.candidates ?? [];
  const acceptedCandidates = candidates.filter((c) => c.accepted);
  const accepted = acceptedCandidates.length;

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
      {creatingSkill && (
        <CreateSkillFromConventionsModal
          repoFullName={repoName}
          acceptedCandidates={acceptedCandidates}
          onClose={() => setCreatingSkill(false)}
        />
      )}

      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.repoName}>
                {repoName}
              </span>
            </h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
            <p style={s.meta}>
              {state
                ? state.last_scan_at
                  ? t("page.detectedFrom", {
                      count: state.sample_file_count,
                      time: relativeTime(state.last_scan_at),
                    })
                  : t("page.neverScanned")
                : ""}
            </p>
          </div>
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={extract.isPending || scanning}
            disabled={extract.isPending || scanning}
            onClick={() => extract.mutate()}
          >
            {scanning
              ? t("page.scanning")
              : state?.last_scan_at
                ? t("page.rescan")
                : t("page.runExtraction")}
          </Button>
        </div>

        {!isLoading && !isError && candidates.length > 0 && (
          <div style={s.toolbar}>
            <span style={s.toolbarCount}>{t("list.acceptedCount", { accepted, total: candidates.length })}</span>
            <div style={s.toolbarSpacer} />
            {accepted > 0 && (
              <Button
                kind="ghost"
                size="sm"
                onClick={() => acceptedCandidates.forEach((c) => update.mutate({ id: c.id, patch: { accepted: false } }))}
              >
                {t("list.deselectAll")}
              </Button>
            )}
            <Button kind="primary" size="sm" icon="Sparkles" disabled={accepted === 0} onClick={() => setCreatingSkill(true)}>
              {t("list.createSkill")}
            </Button>
          </div>
        )}

        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={140} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("page.loadError")}
            body={error instanceof ApiError ? error.message : undefined}
            onRetry={() => refetch()}
          />
        ) : candidates.length === 0 ? (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => extract.mutate()}
            ctaLoading={extract.isPending}
          />
        ) : (
          <div style={s.list}>
            {candidates.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                repoFullName={activeRepo?.full_name}
                defaultBranch={activeRepo?.default_branch}
                repoProvider={activeRepo?.provider}
                repoHost={activeRepo?.host}
                pending={update.isPending && update.variables?.id === c.id}
                onUpdate={(patch) => update.mutate({ id: c.id, patch })}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
