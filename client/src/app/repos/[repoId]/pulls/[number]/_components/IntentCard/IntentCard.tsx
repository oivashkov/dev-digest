/* IntentCard — Intent Layer UI. Renders the PR's classified intent (Overview
   tab): the intent statement, in/out-of-scope lists, confidence, source, and
   any referenced plan/spec paths, plus a manual Refresh trigger.

   Data flow: usePrIntent (GET /pulls/:id/intent, compute-if-missing — mounting
   this component is what "opening the PR" lazily triggers) and
   useRefreshPrIntent (POST .../intent/refresh, forced recompute). Both hooks
   live in `@/lib/hooks/reviews`; this component never calls fetch directly. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  Chip,
  ConfidenceNum,
  EmptyState,
  ErrorState,
  Markdown,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import { usePrIntent, useRefreshPrIntent } from "@/lib/hooks/reviews";
import { ApiError } from "@/lib/api";
import { SOURCE_ICON } from "./constants";
import { s } from "./styles";

export function IntentCard({ prId }: { prId: string | null | undefined }) {
  const t = useTranslations("brief");
  const { data: intent, isLoading, isError, error, refetch } = usePrIntent(prId);
  const refresh = useRefreshPrIntent(prId);

  // Compute-if-missing means a 404 is a genuine failure to compute (VCS
  // unreachable, classifier error, ...), not "not opened yet" — low-confidence
  // results are still a normal 200. Either way there's nothing to render yet.
  const notComputed = isError && error instanceof ApiError && error.status === 404;

  const refreshButton = (
    <Button
      kind="ghost"
      size="sm"
      icon="RefreshCw"
      title={t("intent.refreshTooltip")}
      loading={refresh.isPending}
      disabled={!prId || isLoading}
      onClick={() => refresh.mutate()}
    >
      {t("intent.refresh")}
    </Button>
  );

  return (
    <section>
      <SectionLabel icon="Target" right={refreshButton}>
        {t("block.intent")}
      </SectionLabel>

      {isLoading && (
        <Card>
          <div style={s.skeletonStack}>
            <Skeleton height={16} width="60%" />
            <Skeleton height={14} />
            <Skeleton height={14} width="80%" />
          </div>
        </Card>
      )}

      {!isLoading && notComputed && (
        <Card>
          <EmptyState icon="Sparkles" title={t("unavailable")} body={t("unavailableHint")} />
        </Card>
      )}

      {!isLoading && isError && !notComputed && (
        <Card>
          <ErrorState
            title={t("intent.errorTitle")}
            body={t("intent.errorBody")}
            onRetry={() => refetch()}
          />
        </Card>
      )}

      {!isLoading && !isError && intent && (
        <Card>
          <div style={s.body}>
            <Markdown>{`> ${intent.intent}`}</Markdown>

            <div style={s.metaRow}>
              <ConfidenceNum value={intent.confidence} />
              {intent.source && (
                <Badge icon={SOURCE_ICON[intent.source]}>{t(`intent.source.${intent.source}`)}</Badge>
              )}
            </div>

            {intent.in_scope.length > 0 && (
              <div>
                <div style={s.listLabel}>{t("intent.inScope")}</div>
                <div style={s.chipsRow}>
                  {intent.in_scope.map((item) => (
                    <Chip key={item}>{item}</Chip>
                  ))}
                </div>
              </div>
            )}

            {intent.out_of_scope.length > 0 && (
              <div>
                <div style={s.listLabel}>{t("intent.outOfScope")}</div>
                <div style={s.chipsRow}>
                  {intent.out_of_scope.map((item) => (
                    <Chip key={item}>{item}</Chip>
                  ))}
                </div>
              </div>
            )}

            {intent.plan_refs.length > 0 && (
              <div>
                <div style={s.listLabel}>{t("intent.planRefs")}</div>
                <ul style={s.refList}>
                  {intent.plan_refs.map((ref) => (
                    <li key={ref} className="mono" style={s.refItem}>
                      {ref}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}
    </section>
  );
}
