"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { PrBriefCard } from "../PrBriefCard";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null | undefined;
  prBody: string | null | undefined;
  repoFullName?: string | null;
  repoProvider?: "github" | "gitlab";
  repoHost?: string;
  headSha?: string | null;
  onOpenFile?: (file: string, line?: number) => void;
}

export function OverviewTab({
  prId,
  prBody,
  repoFullName,
  repoProvider,
  repoHost,
  headSha,
  onOpenFile,
}: OverviewTabProps) {
  return (
    <div style={s.wrap}>
      <PrBriefCard prId={prId} headSha={headSha} onOpenFile={onOpenFile} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
      <IntentCard prId={prId} />
      <BlastRadiusCard
        prId={prId}
        repoFullName={repoFullName}
        repoProvider={repoProvider}
        repoHost={repoHost}
        headSha={headSha}
      />
    </div>
  );
}
