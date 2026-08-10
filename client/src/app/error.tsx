"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Button } from "@devdigest/ui";

/**
 * Route-segment error boundary (Next.js file convention). Catches render
 * throws in any page/component below the root layout — without this, an
 * unhandled throw whitescreens the app with no recovery path.
 *
 * Renders inside RootLayout, so NextIntlClientProvider is still available
 * (unlike global-error.tsx, which replaces the whole layout — see that file).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

  useEffect(() => {
    // No error-reporting service wired up yet — console is the only sink.
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <EmptyState icon="AlertTriangle" title={t("states.error")} body={error.message} />
      <Button kind="secondary" icon="RefreshCw" onClick={reset}>
        {t("actions.retry")}
      </Button>
    </div>
  );
}
