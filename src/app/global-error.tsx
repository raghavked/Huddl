"use client";

import { useEffect } from "react";

/**
 * Last-resort crash screen. This replaces the root layout entirely, so
 * globals.css, fonts, and tokens may not be loaded — it stays deliberately
 * plain: system fonts, CSS system colors (which follow the visitor's
 * light/dark preference), inline styles only.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" style={{ colorScheme: "light dark" }}>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "Canvas",
          color: "CanvasText",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', sans-serif",
          textAlign: "center",
        }}
      >
        <main style={{ maxWidth: "26rem" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Something broke on our end
          </h1>
          <p
            style={{
              margin: "0.75rem 0 1.5rem",
              fontSize: "0.9375rem",
              lineHeight: 1.5,
              opacity: 0.7,
            }}
          >
            It&apos;s not you — Huddl hit a snag it couldn&apos;t recover
            from. A retry usually brings it back.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "999px",
              border: "1px solid currentColor",
              background: "transparent",
              color: "inherit",
              font: "inherit",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p
              style={{
                marginTop: "1.5rem",
                fontFamily: "monospace",
                fontSize: "0.75rem",
                opacity: 0.6,
              }}
            >
              Error code: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
