"use client";

/**
 * Root-layout error boundary (Next.js file convention). Only fires when
 * RootLayout itself throws — error.tsx (same directory) handles everything
 * below it and is what fires in practice for almost all render errors.
 *
 * MUST render its own <html>/<body>: it fully replaces the root layout, so
 * NextIntlClientProvider (and every other layout provider) is unavailable
 * here — hardcoded English text is the documented, intentional exception to
 * the "user-facing strings go through next-intl" rule for this one file.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          height: "100vh",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ fontSize: 14, color: "#888", maxWidth: 340, textAlign: "center" }}>
          {error.message}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "7px 14px",
            borderRadius: 6,
            border: "1px solid #444",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </body>
    </html>
  );
}
