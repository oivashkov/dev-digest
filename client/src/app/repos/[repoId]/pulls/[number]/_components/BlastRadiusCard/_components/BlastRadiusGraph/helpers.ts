import type { PrBlastSymbol } from "@devdigest/shared";
import {
  COLUMN_X,
  LABEL_MAX_CHARS,
  MAX_GRAPH_CALLERS,
  MAX_GRAPH_ENDPOINTS,
  MAX_GRAPH_SYMBOLS,
  ROW_HEIGHT,
  SVG_WIDTH,
  TOP_PADDING,
} from "./constants";

export interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: string;
  from: GraphNode;
  to: GraphNode;
  /** True when the edge skips the caller column (symbol → endpoint) — drawn
     as an arching curve instead of a straight line so it reads as a
     distinct "reaches" relationship rather than a direct call. */
  skipsColumn: boolean;
}

export interface GraphLayout {
  symbolNodes: GraphNode[];
  callerNodes: GraphNode[];
  endpointNodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

/** Shorten a file path / endpoint string for an SVG node label, keeping the
   tail (most identifying part of a path) rather than the head. */
export function truncateLabel(label: string, max = LABEL_MAX_CHARS): string {
  if (label.length <= max) return label;
  return `…${label.slice(-(max - 1))}`;
}

function columnNodes(items: { id: string; label: string }[], x: number, maxRows: number): GraphNode[] {
  const offset = ((maxRows - items.length) * ROW_HEIGHT) / 2;
  return items.map((item, i) => ({
    id: item.id,
    label: truncateLabel(item.label),
    x,
    y: TOP_PADDING + offset + i * ROW_HEIGHT + ROW_HEIGHT / 2,
  }));
}

/**
 * Pure layout builder: 3 fixed columns (changed symbols → resolved callers →
 * impacted endpoints), each independently capped and ranked/deduped. Callers
 * are deduped by file (one node per caller file, highest rank wins);
 * endpoints are deduped by their "METHOD /path" string. Edges are symbol→
 * caller (real, backed by `PrBlastCaller`) and symbol→endpoint (endpoints are
 * only known per-symbol, not per-caller, in the `PrBlastRadius` contract —
 * there is no caller→endpoint edge to draw honestly).
 */
export function buildGraphLayout(symbols: PrBlastSymbol[]): GraphLayout {
  const cappedSymbols = symbols.slice(0, MAX_GRAPH_SYMBOLS);

  const callerRank = new Map<string, number>();
  for (const symbol of cappedSymbols) {
    for (const caller of symbol.callers) {
      const prev = callerRank.get(caller.file);
      if (prev == null || caller.rank > prev) callerRank.set(caller.file, caller.rank);
    }
  }
  const callerIds = Array.from(callerRank.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_GRAPH_CALLERS)
    .map(([file]) => file);
  const callerIdSet = new Set(callerIds);

  const endpointIds: string[] = [];
  const seenEndpoints = new Set<string>();
  outer: for (const symbol of cappedSymbols) {
    for (const endpoint of symbol.endpoints) {
      if (seenEndpoints.has(endpoint)) continue;
      seenEndpoints.add(endpoint);
      endpointIds.push(endpoint);
      if (endpointIds.length >= MAX_GRAPH_ENDPOINTS) break outer;
    }
  }
  const endpointIdSet = new Set(endpointIds);

  const maxRows = Math.max(cappedSymbols.length, callerIds.length, endpointIds.length, 1);

  const symbolNodes = columnNodes(
    cappedSymbols.map((symbol) => ({ id: `${symbol.file}::${symbol.name}`, label: symbol.name })),
    COLUMN_X.symbol,
    maxRows,
  );
  const callerNodes = columnNodes(
    callerIds.map((file) => ({ id: file, label: file })),
    COLUMN_X.caller,
    maxRows,
  );
  const endpointNodes = columnNodes(
    endpointIds.map((endpoint) => ({ id: endpoint, label: endpoint })),
    COLUMN_X.endpoint,
    maxRows,
  );

  const symbolNodeById = new Map(symbolNodes.map((n) => [n.id, n]));
  const callerNodeById = new Map(callerNodes.map((n) => [n.id, n]));
  const endpointNodeById = new Map(endpointNodes.map((n) => [n.id, n]));

  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  for (const symbol of cappedSymbols) {
    const symbolNode = symbolNodeById.get(`${symbol.file}::${symbol.name}`);
    if (!symbolNode) continue;

    for (const caller of symbol.callers) {
      if (!callerIdSet.has(caller.file)) continue;
      const callerNode = callerNodeById.get(caller.file);
      if (!callerNode) continue;
      const id = `${symbolNode.id}->${callerNode.id}`;
      if (seenEdges.has(id)) continue;
      seenEdges.add(id);
      edges.push({ id, from: symbolNode, to: callerNode, skipsColumn: false });
    }

    for (const endpoint of symbol.endpoints) {
      if (!endpointIdSet.has(endpoint)) continue;
      const endpointNode = endpointNodeById.get(endpoint);
      if (!endpointNode) continue;
      const id = `${symbolNode.id}=>${endpointNode.id}`;
      if (seenEdges.has(id)) continue;
      seenEdges.add(id);
      edges.push({ id, from: symbolNode, to: endpointNode, skipsColumn: true });
    }
  }

  return {
    symbolNodes,
    callerNodes,
    endpointNodes,
    edges,
    width: SVG_WIDTH,
    height: TOP_PADDING * 2 + maxRows * ROW_HEIGHT,
  };
}

/** SVG path `d` for one edge — a straight line between adjacent columns, or
   a quadratic curve arching above the caller column when the edge skips it
   (symbol → endpoint). */
export function edgePath(edge: GraphEdge): string {
  const { from, to } = edge;
  if (!edge.skipsColumn) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const midX = (from.x + to.x) / 2;
  const controlY = Math.min(from.y, to.y) - 36;
  return `M ${from.x} ${from.y} Q ${midX} ${controlY} ${to.x} ${to.y}`;
}
