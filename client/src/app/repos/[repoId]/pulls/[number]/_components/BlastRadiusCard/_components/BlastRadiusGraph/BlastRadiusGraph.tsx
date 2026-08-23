/* BlastRadiusGraph — hand-rolled inline SVG, no graph library and no reuse of
   `components/mermaid-diagram/MermaidDiagram.tsx` (rejected in
   docs/plans/blast-radius.md §4f: hardcoded dark theme, `innerHTML`-based
   render of untrusted repo text, no clickable nodes, untestable lazy import
   in jsdom). Layout is trivial by construction — 3 fixed columns, each
   independently capped — so `x` is "which column" and `y` is an even split;
   see `helpers.ts#buildGraphLayout`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import type { PrBlastSymbol } from "@devdigest/shared";
import { buildGraphLayout, edgePath } from "./helpers";
import { NODE_RADIUS } from "./constants";
import { NODE_COLOR, s } from "./styles";

export function BlastRadiusGraph({ symbols }: { symbols: PrBlastSymbol[] }) {
  const t = useTranslations("blast");
  const layout = React.useMemo(() => buildGraphLayout(symbols), [symbols]);
  const isEmpty = layout.callerNodes.length === 0 && layout.endpointNodes.length === 0;

  if (isEmpty) {
    return <EmptyState icon="Workflow" title={t("graph.empty")} />;
  }

  return (
    <div style={s.wrap}>
      <div style={s.captionRow}>{t("graph.caption")}</div>

      <svg
        role="img"
        aria-label={t("graph.ariaLabel")}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={s.svg}
      >
        {layout.edges.map((edge) => (
          <path key={edge.id} d={edgePath(edge)} style={s.edge} />
        ))}

        {layout.symbolNodes.map((node) => (
          <g key={node.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r={NODE_RADIUS}
              fill={NODE_COLOR.symbol.fill}
              stroke={NODE_COLOR.symbol.stroke}
              strokeWidth={1.5}
            />
            <text x={node.x + NODE_RADIUS + 6} y={node.y + 3} className="mono" style={s.nodeLabel}>
              {node.label}
            </text>
          </g>
        ))}

        {layout.callerNodes.map((node) => (
          <g key={node.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r={NODE_RADIUS}
              fill={NODE_COLOR.caller.fill}
              stroke={NODE_COLOR.caller.stroke}
              strokeWidth={1.5}
            />
            <text x={node.x + NODE_RADIUS + 6} y={node.y + 3} className="mono" style={s.nodeLabel}>
              {node.label}
            </text>
          </g>
        ))}

        {layout.endpointNodes.map((node) => (
          <g key={node.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r={NODE_RADIUS}
              fill={NODE_COLOR.endpoint.fill}
              stroke={NODE_COLOR.endpoint.stroke}
              strokeWidth={1.5}
            />
            <text x={node.x + NODE_RADIUS + 6} y={node.y + 3} className="mono" style={s.nodeLabel}>
              {node.label}
            </text>
          </g>
        ))}
      </svg>

      <div style={s.legendRow}>
        <span style={s.legendItem}>
          <span style={{ ...s.legendDot, background: NODE_COLOR.symbol.stroke }} />
          {t("graph.legend.changedSymbol")}
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.legendDot, background: NODE_COLOR.caller.stroke }} />
          {t("graph.legend.callers")}
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.legendDot, background: NODE_COLOR.endpoint.stroke }} />
          {t("graph.legend.endpoints")}
        </span>
      </div>
    </div>
  );
}
