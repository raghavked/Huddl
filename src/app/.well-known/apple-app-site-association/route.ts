import { NextResponse } from "next/server";

/**
 * `/.well-known/apple-app-site-association`: the file iOS fetches to decide
 * whether a `https://uhearth.app/...` link belongs to the Hearth app.
 *
 * Served with no extension and `application/json`, exactly as Apple's CDN
 * expects, and never behind a redirect (the middleware matcher lets this path
 * through untouched; see `docs/DEEP_LINKS.md`).
 */

/** Ten alphanumerics, Developer portal → Membership details → Team ID. */
const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;

const BUNDLE_ID = "app.uhearth.mobile";

/**
 * Apple's CDN re-fetches on its own schedule and devices cache what it hands
 * them, so serve this cold and let it sit. The 404 below is the opposite:
 * `no-store`, so the day someone sets `APPLE_TEAM_ID` the real document is
 * live immediately instead of waiting out a cached miss.
 */
const CACHE_CONTROL =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";

type AasaComponent = {
  "/": string;
  exclude?: true;
  comment: string;
};

/**
 * iOS takes the *first* component that matches, so the exclusions come first.
 * We claim only the paths the app can actually route. Everything else stays
 * in the browser, which is a better outcome than opening the app onto a dead
 * end. Keep this list in step with the table in `docs/DEEP_LINKS.md`.
 */
const COMPONENTS: AasaComponent[] = [
  {
    "/": "/channels/browse",
    exclude: true,
    // Comments stay plain ASCII: this document is parsed by Apple's CDN and
    // by iOS, not read by a person, and neither owes us a UTF-8 courtesy.
    comment: "Channel directory is web-only; the app has no twin screen.",
  },
  {
    "/": "/channels/new",
    exclude: true,
    comment: "New-channel form is web-only.",
  },
  {
    "/": "/messages/new-group",
    exclude: true,
    comment: "Group-DM composer is web-only.",
  },
  { "/": "/channels/*", comment: "A channel." },
  { "/": "/clubs/*", comment: "A club." },
  { "/": "/courses/*", comment: "A course home." },
  { "/": "/events/*", comment: "An event." },
  { "/": "/messages/*", comment: "A direct message thread." },
  { "/": "/u/*", comment: "A student's profile." },
];

/**
 * Read at request time, not build time: the team ID often lands in the
 * environment after the first deploy, and a prerendered 404 would outlive it.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim().toUpperCase();

  // No team ID (or a placeholder someone pasted in) means no document. A
  // malformed AASA is worse than a missing one: iOS caches what it fetches,
  // so a wrong appID keeps every link opening the browser long after the fix.
  if (!teamId || !TEAM_ID_PATTERN.test(teamId)) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: [`${teamId}.${BUNDLE_ID}`],
            components: COMPONENTS,
          },
        ],
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": CACHE_CONTROL,
      },
    }
  );
}
