import { ImageResponse } from "next/og";

/* Social share card. ImageResponse renders outside the app's CSS, so token
   classes don't exist here — this file is the one sanctioned home for raw
   hex (brand violet #6c3df4 → raspberry #d6336c, the v2 gradient). The mark
   geometry is copied verbatim from src/components/logo.tsx; keep them in
   sync if the logo ever changes. */

export const alt = "Huddl — Your campus, in one huddle.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
          background: "linear-gradient(135deg, #6c3df4 0%, #d6336c 100%)",
          color: "#ffffff",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          {/* The huddl mark — four rounded students leaning into a huddle */}
          <svg width={150} height={150} viewBox="0 0 32 32" aria-hidden>
            <circle cx="16" cy="7.5" r="4.1" fill="#ffffff" />
            <circle cx="7" cy="14.5" r="3.4" fill="rgba(255, 255, 255, 0.75)" />
            <circle
              cx="25"
              cy="14.5"
              r="3.4"
              fill="rgba(255, 255, 255, 0.75)"
            />
            <path
              d="M16 13.5c-5.6 0-9.5 3.6-9.5 9.2 0 2.6 1.9 4.3 4.6 4.3h9.8c2.7 0 4.6-1.7 4.6-4.3 0-5.6-3.9-9.2-9.5-9.2z"
              fill="#ffffff"
            />
          </svg>
          <div
            style={{
              fontSize: 168,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              lineHeight: 1,
            }}
          >
            huddl
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
          Your campus, in one huddle.
        </div>
      </div>
    ),
    { ...size }
  );
}
