/* Graph is strictly 3-level and pre-capped — there is no general layout
   problem to solve, so `x` is just "which column" and `y` is an even split
   (see docs/plans/blast-radius.md §4f). These caps keep the SVG readable
   even when a symbol has hundreds of resolved callers. */
export const MAX_GRAPH_SYMBOLS = 8;
export const MAX_GRAPH_CALLERS = 8;
export const MAX_GRAPH_ENDPOINTS = 6;

export const COLUMN_X = { symbol: 90, caller: 320, endpoint: 550 } as const;
export const ROW_HEIGHT = 34;
export const TOP_PADDING = 24;
export const SVG_WIDTH = 620;
export const NODE_RADIUS = 5;
export const LABEL_MAX_CHARS = 28;
