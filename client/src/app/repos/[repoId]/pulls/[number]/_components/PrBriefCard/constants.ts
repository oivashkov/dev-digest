import type { IconName } from "@devdigest/ui";
import type { RiskSeverity } from "@devdigest/shared";

/** Icon per `risk_level` — matches `riskBrief.riskLevel.*` i18n labels. */
export const RISK_LEVEL_ICON: Record<RiskSeverity, IconName> = {
  high: "AlertOctagon",
  medium: "AlertTriangle",
  low: "Info",
};

/** Colour per `risk_level`, reusing the existing severity CSS variables
   (`--crit`/`--warn`/--info` + their `-bg` pairs) — no new colour tokens,
   and never added to `vendor/ui/styles.css` (vendored, off-limits). */
export const RISK_LEVEL_COLOR: Record<RiskSeverity, { color: string; bg: string }> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)" },
  low: { color: "var(--info)", bg: "var(--info-bg)" },
};

/** `risks[].severity` uses the same `RiskSeverity` domain as `risk_level` —
   reuse the same icon/colour maps for the per-risk badges. */
export const RISK_ICON = RISK_LEVEL_ICON;
export const RISK_COLOR = RISK_LEVEL_COLOR;
