/* BlastRadiusCard — Blast Radius panel (Overview tab, below IntentCard).
   Deterministic, no-LLM answer to "what does this PR touch, transitively?":
   symbols declared in the PR's changed files, their resolved callers
   (`file:line`, clickable), and the HTTP endpoints / cron jobs reachable
   within a 2-level reverse import walk of the repo-intel index — plus a
   Tree|Graph view switch (docs/plans/blast-radius.md).

   Data flow: useBlastRadius (GET /pulls/:id/blast), computed fresh on every
   call, no caching. This component never calls fetch directly. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/reviews";
import { STAT_ICON } from "./constants";
import { isBlastEmpty, reasonKey } from "./helpers";
import { BlastRadiusTree } from "./_components/BlastRadiusTree";
import { BlastRadiusGraph } from "./_components/BlastRadiusGraph";
import { s } from "./styles";

type ViewMode = "tree" | "graph";
const STAT_KEYS = ["symbols", "callers", "endpoints", "crons"] as const;

export function BlastRadiusCard({
  prId,
  repoFullName,
  repoProvider,
  repoHost,
  headSha,
}: {
  prId: string | null | undefined;
  repoFullName?: string | null;
  repoProvider?: "github" | "gitlab";
  repoHost?: string;
  headSha?: string | null;
}) {
  const t = useTranslations("blast");
  const tBrief = useTranslations("brief");
  const { data, isLoading, isError, refetch } = useBlastRadius(prId);
  // Both views render from the same already-fetched response — switching
  // never issues a new request (react-best-practices, "Derive, Don't Store").
  const [mode, setMode] = React.useState<ViewMode>("tree");

  const loaded = !isLoading && !isError && !!data;

  const viewSwitch = (
    <div style={s.viewSwitch}>
      <Button
        kind="ghost"
        size="sm"
        active={mode === "tree"}
        style={mode === "tree" ? s.viewButtonActive : undefined}
        onClick={() => setMode("tree")}
      >
        {t("view.tree")}
      </Button>
      <Button
        kind="ghost"
        size="sm"
        active={mode === "graph"}
        style={mode === "graph" ? s.viewButtonActive : undefined}
        onClick={() => setMode("graph")}
      >
        {t("view.graph")}
      </Button>
    </div>
  );

  return (
    <section>
      <SectionLabel icon="Workflow" right={loaded ? viewSwitch : undefined}>
        {tBrief("block.blast")}
      </SectionLabel>

      {isLoading && (
        <Card>
          <div style={s.skeletonStack}>
            <Skeleton height={16} width="50%" />
            <Skeleton height={14} />
            <Skeleton height={14} width="70%" />
          </div>
        </Card>
      )}

      {!isLoading && isError && (
        <Card>
          <ErrorState title={t("errorTitle")} body={t("errorBody")} onRetry={() => refetch()} />
        </Card>
      )}

      {loaded && (
        <Card>
          <div style={s.body}>
            <div style={s.statsRow}>
              {STAT_KEYS.map((key) => {
                const StatIcon = Icon[STAT_ICON[key]];
                return (
                  <span key={key} style={s.stat}>
                    <StatIcon size={13} />
                    <span className="tnum" style={s.statCount}>
                      {data.counts[key]}
                    </span>
                    {t(`stat.${key}`)}
                  </span>
                );
              })}
            </div>

            {/* Degraded/partial gets an explicit banner — an empty array
               without this explanation would read as "nothing depends on
               this", not "the index couldn't tell us". */}
            {data.status !== "full" && (
              <div style={s.statusBanner}>
                <Icon.AlertTriangle size={13} />
                <Badge>{t(`status.badge.${data.status}`)}</Badge>
                <span>{t(`status.reason.${reasonKey(data.reason)}`)}</span>
              </div>
            )}

            {isBlastEmpty(data) ? (
              <EmptyState icon="Workflow" title={t("noDownstream", { count: data.counts.symbols })} />
            ) : mode === "tree" ? (
              <BlastRadiusTree
                symbols={data.symbols}
                repoFullName={repoFullName}
                repoProvider={repoProvider}
                repoHost={repoHost}
                headSha={headSha}
              />
            ) : (
              <BlastRadiusGraph symbols={data.symbols} />
            )}
          </div>
        </Card>
      )}
    </section>
  );
}
