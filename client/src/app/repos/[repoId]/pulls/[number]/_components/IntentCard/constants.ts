import type { IconName } from "@devdigest/ui";
import type { Intent } from "@devdigest/shared";

/** Per-`source` badge icon. Labels themselves come from `brief.intent.source.*`
   (i18n) — this only maps the deterministic-tier provenance to a glyph. */
export const SOURCE_ICON: Record<NonNullable<Intent["source"]>, IconName> = {
  spec: "FileText",
  ticket: "Tag",
  description: "MessageSquare",
  inferred: "Sparkles",
};
