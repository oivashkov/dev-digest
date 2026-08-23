/* BlastRadiusTree — default view for BlastRadiusCard. One expandable row per
   changed symbol; expanding reveals its resolved callers (clickable
   `file:line`, opens the VCS blob at that line) and the endpoints/crons that
   symbol can reach within a 2-level reverse import walk. Purely a renderer —
   `symbols` comes from BlastRadiusCard's already-fetched `useBlastRadius`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, MonoLink } from "@devdigest/ui";
import type { PrBlastSymbol } from "@devdigest/shared";
import { vcsBlobUrl } from "@/lib/vcs-urls";
import { symbolKey } from "./helpers";
import { ENDPOINT_BADGE, CRON_BADGE } from "./constants";
import { s } from "./styles";

export function BlastRadiusTree({
  symbols,
  repoFullName,
  repoProvider = "github",
  repoHost = "github.com",
  headSha,
}: {
  symbols: PrBlastSymbol[];
  repoFullName?: string | null;
  repoProvider?: "github" | "gitlab";
  repoHost?: string;
  headSha?: string | null;
}) {
  const t = useTranslations("blast");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div style={s.list}>
      {symbols.map((symbol) => {
        const key = symbolKey(symbol);
        const open = expanded.has(key);
        const hasDownstream =
          symbol.callers.length > 0 || symbol.endpoints.length > 0 || symbol.crons.length > 0;

        return (
          <div key={key} style={s.item}>
            <button type="button" onClick={() => toggle(key)} style={s.header} aria-expanded={open}>
              {open ? <Icon.ChevronDown size={14} /> : <Icon.ChevronRight size={14} />}
              <Icon.Code size={13} style={s.symbolIcon} />
              <span className="mono" style={s.symbolName}>
                {symbol.name}
              </span>
              <span className="mono" style={s.symbolFile}>
                {symbol.file}
              </span>
              <span style={s.callerCount}>{t("callerCount", { count: symbol.callers.length })}</span>
            </button>

            {open && (
              <div style={s.detail}>
                {!hasDownstream && <div style={s.muted}>{t("symbol.noCallers")}</div>}

                {symbol.callers.map((caller) => {
                  const href =
                    repoFullName && headSha
                      ? vcsBlobUrl(
                          repoFullName,
                          headSha,
                          caller.file,
                          repoProvider,
                          repoHost,
                          caller.line,
                        )
                      : undefined;
                  return (
                    <div key={`${caller.file}:${caller.line}:${caller.symbol}`} style={s.callerRow}>
                      <Icon.CornerDownRight size={12} style={s.symbolIcon} />
                      <MonoLink href={href}>
                        {caller.file}:{caller.line}
                      </MonoLink>
                    </div>
                  );
                })}

                {(symbol.endpoints.length > 0 || symbol.crons.length > 0) && (
                  <div style={s.badgeRow}>
                    {symbol.endpoints.map((endpoint) => (
                      <Badge
                        key={endpoint}
                        icon="Globe"
                        color={ENDPOINT_BADGE.color}
                        bg={ENDPOINT_BADGE.bg}
                      >
                        {endpoint}
                      </Badge>
                    ))}
                    {symbol.crons.map((cron) => (
                      <Badge key={cron} icon="Clock" color={CRON_BADGE.color} bg={CRON_BADGE.bg}>
                        {cron}
                      </Badge>
                    ))}
                  </div>
                )}

                {symbol.callers_truncated && <div style={s.muted}>{t("symbol.callersTruncated")}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
