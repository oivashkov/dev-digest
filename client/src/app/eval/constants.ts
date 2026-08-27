/* Route-level constants for /eval and /eval/:agentId — shared by the
   workspace dashboard's collapsed agent rows (AgentDashboardCard) and the
   per-agent drill-down page (AgentEvalDetailView), so both render the same
   colored metric everywhere the three eval metrics appear (row numbers,
   MetricCard tiles, and the LineChart legend/series). Colors reuse this
   app's existing design tokens rather than inventing new ones — `--accent`
   is this theme's blue, `--ok` its green, `--warn` its orange
   (`src/vendor/ui/styles.css`), the same blue/green pairing
   `components/showcase/Showcase.tsx` already uses for a recall/precision
   LineChart demo. */
export const METRIC_COLOR = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
} as const;
