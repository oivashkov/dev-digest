/* FindingsCell — the PR list's FINDINGS column. One compact severity badge
   per non-empty severity (worst first, zero-count severities hidden);
   hovering a badge opens a read-only tooltip listing only that severity's
   findings. Dismissed findings never reach here — the API already excludes
   them (see server/src/modules/pulls/routes.ts). */
"use client";

import React from "react";
import {
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { Finding } from "@/lib/types";
import { HoverPopover } from "@/components/hover-popover";
import { groupFindingsBySeverity } from "../../../../helpers";
import { s } from "./styles";

/** "11" for a single-line finding, "11-15" for a range. */
function lineLabel(f: Pick<Finding, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

function SeverityTooltip({ severity, findings }: { severity: Severity; findings: Finding[] }) {
  return (
    <div>
      <SeverityBadge severity={severity} count={findings.length} />
      <div style={s.tooltipList}>
        {findings.map((f, i) => (
          <div key={f.id} style={i === 0 ? s.tooltipItemFirst : s.tooltipItem}>
            <div style={s.titleRow}>
              <span style={s.title}>{f.title}</span>
              <CategoryTag category={f.category as Category} />
            </div>
            <div style={s.metaRow}>
              <MonoLink>
                {f.file}:{lineLabel(f)}
              </MonoLink>
              <ConfidenceNum value={f.confidence} />
            </div>
            <div style={s.rationale}>
              <Markdown>{f.rationale}</Markdown>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FindingsCell({ findings }: { findings: Finding[] | null | undefined }) {
  // Always render a real DOM node here, even when empty: this cell is a
  // direct child of the row's CSS grid, and a `null` render would drop it
  // from the DOM entirely, shifting every column after it left by one track.
  if (findings == null) return <span style={s.dash}>—</span>;
  const groups = groupFindingsBySeverity(findings);
  if (groups.length === 0) return <div />;

  return (
    <div style={s.wrap}>
      {groups.map((g) => (
        <HoverPopover
          key={g.severity}
          trigger={
            <SeverityBadge severity={g.severity as Severity} count={g.findings.length} compact />
          }
          content={<SeverityTooltip severity={g.severity as Severity} findings={g.findings} />}
        />
      ))}
    </div>
  );
}

export default FindingsCell;
