/* /repos/:repoId/onboarding — Onboarding Tour page (SPEC-02). Read-only,
   cached, per-repo orientation document: architecture, critical paths, local
   setup, a guided reading path, and first tasks — each section collapsible,
   with a copy control on the setup commands and per-link "Open on <host>"
   buttons. Regenerate is async (202 + poll); "Share link" copies the in-app
   URL only — no unauthenticated public link exists (Q6). */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, MonoLink, Skeleton } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { SafeMarkdown } from "@/components/safe-markdown";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useGenerateOnboarding, useOnboardingState } from "@/lib/hooks";
import { vcsBlobUrl } from "@/lib/vcs-urls";
import { ApiError } from "@/lib/api";
import { COPY_FEEDBACK_MS, SECTION_ICON, SKELETON_ROWS } from "./constants";
import { relativeTime, sectionAnchorId } from "./helpers";
import { s } from "./styles";

export function OnboardingTourView() {
  const t = useTranslations("onboarding");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  // `poll` mirrors the last-seen status — flips the query's own
  // refetchInterval on once generation starts, off once it leaves "generating".
  const [poll, setPoll] = React.useState(false);
  const { data: state, isLoading, isError, error, refetch } = useOnboardingState(repoId, poll);
  React.useEffect(() => {
    setPoll(state?.status === "generating");
  }, [state?.status]);
  const generating = state?.status === "generating";

  const generate = useGenerateOnboarding(repoId);
  const [linkCopied, setLinkCopied] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  const repoName = activeRepo?.full_name ?? repoId;
  const sections = state?.tour?.sections ?? [];

  const copyShareLink = () => {
    void navigator.clipboard?.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), COPY_FEEDBACK_MS);
  };

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
            {state && (
              <p style={s.meta}>
                {t("headerMeta", {
                  count: state.files_indexed,
                  time: state.generated_at ? relativeTime(state.generated_at) : t("neverGenerated"),
                })}
              </p>
            )}
          </div>
          <div style={s.headerActions}>
            <Button kind="ghost" icon="Copy" onClick={copyShareLink}>
              {linkCopied ? t("linkCopied") : t("shareLink")}
            </Button>
            {state?.status !== "not_indexed" && (
              <Button
                kind="secondary"
                icon="RefreshCw"
                loading={generate.isPending || generating}
                disabled={generate.isPending || generating}
                onClick={() => generate.mutate()}
              >
                {generate.isPending || generating ? t("regenerating") : t("regenerate")}
              </Button>
            )}
          </div>
        </div>

        {state?.status === "partial" && <div style={s.note}>{t("partial.note")}</div>}
        {state?.status === "failed" && <div style={s.note}>{t("failed.body")}</div>}

        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={100} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("loadError.title")}
            body={error instanceof ApiError ? error.message : undefined}
            onRetry={() => refetch()}
          />
        ) : state?.status === "not_indexed" ? (
          <EmptyState icon="GitBranch" title={t("notIndexed.title")} body={t("notIndexed.body")} />
        ) : sections.length === 0 ? (
          <EmptyState
            icon="Sparkles"
            title={t("generate.title")}
            body={t("generate.body")}
            cta={t("generate.cta")}
            onCta={() => generate.mutate()}
            ctaLoading={generate.isPending}
          />
        ) : (
          <div style={s.body}>
            <nav style={s.rail} aria-label={t("rail.title")}>
              <div style={s.railTitle}>{t("rail.title")}</div>
              {sections.map((sec) => (
                <button
                  key={sec.kind}
                  type="button"
                  style={s.railItem}
                  onClick={() =>
                    document
                      .getElementById(sectionAnchorId(sec.kind))
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  {sec.title}
                </button>
              ))}
            </nav>
            <div style={s.sections}>
              {sections.map((sec) => (
                <SectionCard
                  key={sec.kind}
                  section={sec}
                  open={!collapsed[sec.kind]}
                  onToggle={() =>
                    setCollapsed((prev) => ({ ...prev, [sec.kind]: !prev[sec.kind] }))
                  }
                  repoFullName={activeRepo?.full_name}
                  defaultBranch={activeRepo?.default_branch}
                  repoProvider={activeRepo?.provider}
                  repoHost={activeRepo?.host}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/** One collapsible tour section — header toggles open/closed; the body
 *  renders `body` as sanitized Markdown, an optional mermaid `diagram` (only
 *  on `architecture` — MermaidDiagram itself drops an invalid one silently),
 *  and up to 4 file links opening on the repo's VCS host (Q7). */
function SectionCard({
  section,
  open,
  onToggle,
  repoFullName,
  defaultBranch,
  repoProvider,
  repoHost,
}: {
  section: OnboardingSection;
  open: boolean;
  onToggle: () => void;
  repoFullName?: string | null;
  defaultBranch?: string | null;
  repoProvider?: "github" | "gitlab";
  repoHost?: string;
}) {
  const t = useTranslations("onboarding");
  const [copied, setCopied] = React.useState(false);
  const SectionIcon = Icon[SECTION_ICON[section.kind]];

  const copySetup = () => {
    void navigator.clipboard?.writeText(section.body);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  };

  return (
    <div id={sectionAnchorId(section.kind)} style={s.card}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggle();
        }}
        style={s.cardHeader}
      >
        <SectionIcon size={15} style={{ color: "var(--text-muted)" }} />
        <span style={s.cardTitle}>{section.title}</span>
        {section.kind === "local_setup" && (
          <Button
            kind="ghost"
            size="sm"
            icon="Copy"
            onClick={(e) => {
              e.stopPropagation();
              copySetup();
            }}
          >
            {copied ? t("copied") : t("copySetup")}
          </Button>
        )}
        <Icon.ChevronDown
          size={16}
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .15s",
            color: "var(--text-muted)",
          }}
        />
      </div>

      {open && (
        <div style={s.cardBody}>
          <SafeMarkdown>{section.body}</SafeMarkdown>
          {section.kind === "architecture" && section.diagram && (
            <MermaidDiagram chart={section.diagram} />
          )}
          {section.links.length > 0 && repoFullName && defaultBranch && repoProvider && repoHost && (
            <div style={s.links}>
              {section.links.map((link) => (
                <MonoLink
                  key={link.path}
                  href={vcsBlobUrl(repoFullName, defaultBranch, link.path, repoProvider, repoHost)}
                >
                  {link.label}
                </MonoLink>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
