"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";

/**
 * Root not-found boundary (Next.js file convention) — fires on notFound()
 * calls and unmatched routes.
 *
 * Client Component: @devdigest/ui's barrel unconditionally re-exports
 * ./charts (Recharts-based), which isn't safe to evaluate in the RSC/server
 * bundle ("Super expression must either be null or a function" — a class
 * export resolves to undefined server-side). Every other consumer of
 * @devdigest/ui in this app is already a Client Component for the same
 * reason (see components/repo-not-found/RepoNotFound.tsx) — this file just
 * missed it because it doesn't otherwise need interactivity.
 */
export default function NotFound() {
  const t = useTranslations("common");
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <EmptyState icon="AlertTriangle" title={t("notFound.title")} body={t("notFound.body")} />
      <Link href="/" style={{ fontSize: 13, color: "var(--accent)" }}>
        {t("notFound.cta")}
      </Link>
    </div>
  );
}
