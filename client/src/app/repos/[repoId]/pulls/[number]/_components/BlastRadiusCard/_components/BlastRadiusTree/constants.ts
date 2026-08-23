/** Badge colours for the two downstream-fact kinds a caller can surface —
   endpoints (blue, `Globe`) vs. crons/scheduled jobs (orange, `Clock`) — reuse
   the same semantic CSS-variable tokens `@devdigest/ui`'s own badges draw
   from (`vendor/ui/primitives/tokens.ts`), not hardcoded hex literals. */
export const ENDPOINT_BADGE = { color: "var(--accent-text)", bg: "var(--accent-bg)" } as const;
export const CRON_BADGE = { color: "var(--warn)", bg: "var(--warn-bg)" } as const;
