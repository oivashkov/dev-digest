import type { IconName } from "@devdigest/ui";

/** Stat-bar icon per `counts.*` key — matches `blast.stat.*` i18n labels. */
export const STAT_ICON: Record<"symbols" | "callers" | "endpoints" | "crons", IconName> = {
  symbols: "Code",
  callers: "CornerDownRight",
  endpoints: "Globe",
  crons: "Clock",
};
