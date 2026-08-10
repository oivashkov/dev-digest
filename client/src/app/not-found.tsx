import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@devdigest/ui";

/**
 * Root not-found boundary (Next.js file convention) — fires on notFound()
 * calls and unmatched routes. Server Component (no interactivity needed
 * beyond a plain link), so next-intl's server-side `getTranslations` works
 * directly, unlike error.tsx which needs the client-side hook for `reset()`.
 */
export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <EmptyState icon="AlertTriangle" title={t("notFound.title")} body={t("notFound.body")} />
      <Link href="/" style={{ fontSize: 13, color: "var(--accent)" }}>
        {t("notFound.cta")}
      </Link>
    </div>
  );
}
