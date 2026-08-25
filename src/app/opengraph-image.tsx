import { ImageResponse } from "next/og";

/* Social share card. ImageResponse renders outside the app's CSS, so token
   classes don't exist here. That makes this file the one sanctioned home for
   raw hex (flat ember #b5502f; the old v2 gradient is retired with the rest
   of them). The mark geometry is copied verbatim from
   src/components/logo.tsx; keep them in sync if the logo ever changes. */

export const alt = "Hearth · Your campus, gathered.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* The ember bubble in its chosen colorway: white even-odd path on the ember
   ground, so the flame reads as a window of ember inside a white bubble
   with a white core. */
const MARK_PATH =
  "M9 4h14a6 6 0 0 1 6 6v6a6 6 0 0 1-6 6h-8.5l-5.6 5.1c-.9.8-2.2.1-2.2-1V22H9a6 6 0 0 1-6-6v-6a6 6 0 0 1 6-6z " +
  "M16 8c2.8 2.2 4.9 4.7 4.9 7.4a4.9 4.9 0 0 1-9.8 0C11.1 12.7 13.2 10.2 16 8z " +
  "M16 12.6c1.3 1.2 2.3 2.4 2.3 3.7a2.3 2.3 0 0 1-4.6 0c0-1.3 1-2.5 2.3-3.7z";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#b5502f",
          color: "#ffffff",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <svg width={150} height={150} viewBox="0 0 32 32" aria-hidden>
            <path d={MARK_PATH} fill="#ffffff" fillRule="evenodd" />
          </svg>
          <div
            style={{
              fontSize: 168,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              lineHeight: 1,
            }}
          >
            hearth
          </div>
        </div>
        <div
          style={{
            marginTop: 44,
            fontSize: 44,
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          Your campus, gathered.
        </div>
      </div>
    ),
    { ...size }
  );
}
