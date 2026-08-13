"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Modal, Skeleton } from "@devdigest/ui";
import type { Skill, SkillVersion } from "@devdigest/shared";
import { useSkillVersions, useRestoreSkillVersion } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { diffLines } from "./helpers";
import { s } from "./styles";

/** Versions tab — body-snapshot history. Every save snapshots the body so eval
 *  runs stay reproducible against the exact text they scored (see the design's
 *  "Versions (body snapshots)" header). */
export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion(skill.id);
  const [diffing, setDiffing] = React.useState<SkillVersion | null>(null);

  if (isError) {
    return <ErrorState body={t("versions.loadError")} onRetry={() => refetch()} />;
  }
  if (isLoading || !versions) {
    return (
      <div style={s.wrap}>
        <Skeleton height={24} width={200} />
        <div style={{ marginTop: 14 }}>
          <Skeleton height={64} />
        </div>
      </div>
    );
  }

  const currentVersion = versions[0]?.version;

  const onRestore = (v: SkillVersion) => {
    if (!window.confirm(t("versions.confirmRestore", { version: v.version }))) return;
    restore.mutate(v.version, {
      onSuccess: (data) => toast.success(t("versions.restoredToast", { version: data.version })),
    });
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("versions.title")}</h2>
        <Badge color="var(--text-secondary)">{t("versions.count", { count: versions.length })}</Badge>
      </div>
      <p style={s.subtitle}>{t("versions.hint")}</p>

      {versions.map((v) => (
        <div key={v.version} style={s.row}>
          <Badge color="var(--accent-text)" bg="var(--accent-bg)" mono>
            {t("preview.version", { version: v.version })}
          </Badge>
          <div style={s.rowBody}>
            <div style={s.rowSummary}>{v.summary ?? t("versions.noSummary")}</div>
            <div style={s.rowDate}>{v.created_at.slice(0, 10)}</div>
          </div>
          <div style={s.rowActions}>
            {v.version === currentVersion ? (
              <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
                {t("versions.current")}
              </Badge>
            ) : (
              <>
                <Button kind="secondary" size="sm" icon="Eye" onClick={() => setDiffing(v)}>
                  {t("versions.diff")}
                </Button>
                <Button
                  kind="secondary"
                  size="sm"
                  icon="History"
                  onClick={() => onRestore(v)}
                  disabled={restore.isPending}
                >
                  {t("versions.restore")}
                </Button>
              </>
            )}
          </div>
        </div>
      ))}

      {diffing && (
        <DiffModal skill={skill} version={diffing} onClose={() => setDiffing(null)} onRestore={onRestore} />
      )}
    </div>
  );
}

function DiffModal({
  skill,
  version,
  onClose,
  onRestore,
}: {
  skill: Skill;
  version: SkillVersion;
  onClose: () => void;
  onRestore: (v: SkillVersion) => void;
}) {
  const t = useTranslations("skills");
  const lines = React.useMemo(() => diffLines(version.body, skill.body), [version.body, skill.body]);
  return (
    <Modal
      title={t("versions.diffTitle", { version: version.version })}
      subtitle={t("versions.diffSubtitle")}
      onClose={onClose}
      footer={
        <Button kind="primary" icon="History" onClick={() => onRestore(version)}>
          {t("versions.restore")}
        </Button>
      }
    >
      <div style={s.diffBox}>
        {lines.map((line, i) => (
          <div key={i} style={s.diffLine(line.type)}>
            <span style={s.diffMarker}>{line.type === "add" ? "+" : line.type === "remove" ? "−" : ""}</span>
            {line.text}
          </div>
        ))}
      </div>
    </Modal>
  );
}
