/* PrBriefCard — PR Why + Risk Brief (Overview tab, first card). One-glance
   "what changed, why, how risky, what to read first" summary from a single
   structured LLM call over already-computed signals, mechanically grounded
   so every risks[]/review_focus[] file/endpoint reference is real.

   Data flow: usePrBrief (GET /pulls/:id/brief, compute-if-missing — mounting
   this component is what "opening the PR" lazily triggers, same contract as
   IntentCard) and useRefreshPrBrief (POST .../brief/refresh, forced
   recompute). Both hooks live in `@/lib/hooks/reviews`; this component never
   calls fetch directly. */
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
  Markdown,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import { usePrBrief, useRefreshPrBrief } from "@/lib/hooks/reviews";
import { ApiError } from "@/lib/api";
import { RISK_COLOR, RISK_ICON, RISK_LEVEL_COLOR, RISK_LEVEL_ICON } from "./constants";
import { s } from "./styles";

export interface PrBriefCardProps {
  prId: string | null | undefined;
  headSha?: string | null;
  onOpenFile?: (file: string, line?: number) => void;
}

export function PrBriefCard({ prId, headSha, onOpenFile }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data: brief, isLoading, isError, error, refetch } = usePrBrief(prId);
  const refresh = useRefreshPrBrief(prId);

  // Compute-if-missing means a 404 is a genuine failure to compute, not "not
  // opened yet" — same distinction IntentCard already makes.
  const notComputed = isError && error instanceof ApiError && error.status === 404;

  const isStale = !!(headSha && brief?.head_sha && headSha !== brief.head_sha);

  const refreshButton = (
    <Button
      kind="ghost"
      size="sm"
      icon="RefreshCw"
      title={t("riskBrief.refreshTooltip")}
      loading={refresh.isPending}
      disabled={!prId || isLoading}
      onClick={() => refresh.mutate()}
    >
      {t("riskBrief.refresh")}
    </Button>
  );

  return (
    <section>
      <SectionLabel icon="Sparkles" right={refreshButton}>
        {t("riskBrief.title")}
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
            title={t("riskBrief.errorTitle")}
            body={t("riskBrief.errorBody")}
            onRetry={() => refetch()}
          />
        </Card>
      )}

      {!isLoading && !isError && brief && (
        <Card>
          <div style={s.body}>
            {isStale && (
              <div style={s.staleHint}>
                <Icon.AlertTriangle size={13} />
                {t("riskBrief.staleHint")}
              </div>
            )}

            <div style={s.metaRow}>
              <Badge
                icon={RISK_LEVEL_ICON[brief.risk_level]}
                color={RISK_LEVEL_COLOR[brief.risk_level].color}
                bg={RISK_LEVEL_COLOR[brief.risk_level].bg}
              >
                {t(`riskBrief.riskLevel.${brief.risk_level}`)}
              </Badge>
            </div>

            <div>
              <div style={s.listLabel}>{t("riskBrief.what")}</div>
              <Markdown>{brief.what}</Markdown>
            </div>

            <div>
              <div style={s.listLabel}>{t("riskBrief.why")}</div>
              <Markdown>{brief.why}</Markdown>
            </div>

            <div>
              <div style={s.listLabel}>{t("block.risks")}</div>
              {brief.risks.length === 0 ? (
                <div style={s.noRisks}>{t("noRisks")}</div>
              ) : (
                <ul style={s.riskList}>
                  {brief.risks.map((risk, i) => (
                    <li key={`${risk.title}-${i}`} style={s.riskItem}>
                      <div style={s.riskItemHeader}>
                        <Badge
                          icon={RISK_ICON[risk.severity]}
                          color={RISK_COLOR[risk.severity].color}
                          bg={RISK_COLOR[risk.severity].bg}
                        >
                          {t(`riskBrief.riskLevel.${risk.severity}`)}
                        </Badge>
                        <span style={s.riskItemTitle}>{risk.title}</span>
                      </div>
                      <div style={s.riskItemExplanation}>{risk.explanation}</div>
                      {risk.file_refs.length > 0 && (
                        <div style={s.riskItemFiles}>
                          {risk.file_refs.map((file) => (
                            <span key={file} className="mono" style={s.focusItem}>
                              {file}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {brief.review_focus.length > 0 && (
              <div>
                <div style={s.listLabel}>{t("riskBrief.reviewFocus")}</div>
                <ul style={s.focusList}>
                  {brief.review_focus.map((item, i) => {
                    const label = item.line != null ? `${item.file}:${item.line}` : item.file;
                    return (
                      <li key={`${item.file}-${item.line ?? ""}-${i}`}>
                        {onOpenFile ? (
                          <button
                            type="button"
                            className="mono"
                            style={s.focusItemButton}
                            aria-label={t("riskBrief.focusItemAriaLabel", { file: label })}
                            onClick={() => onOpenFile(item.file, item.line ?? undefined)}
                          >
                            <Icon.Search size={12} />
                            {label} — {item.reason}
                          </button>
                        ) : (
                          <span className="mono" style={s.focusItem}>
                            {label} — {item.reason}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}
    </section>
  );
}
