import { NextResponse } from "next/server";

/**
 * `/.well-known/assetlinks.json`, the Digital Asset Links statement Android
 * fetches to verify that `app.huddl.mobile` may open `https://huddl.app/...`
 * links without the disambiguation dialog.
 */

/** Uppercase hex, colon-separated: 32 bytes → 32 pairs, 31 colons. */
const FINGERPRINT_PATTERN = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

const PACKAGE_NAME = "app.huddl.mobile";

/**
 * Long, because the statement changes about once a decade. The 404 below is
 * `no-store` instead, so setting `ANDROID_CERT_SHA256` takes effect at once.
 */
const CACHE_CONTROL =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";

/** Read at request time so the env var can land after the first deploy. */
export const dynamic = "force-dynamic";

export async function GET() {
  // Usually more than one: Play App Signing holds the release cert while your
  // upload cert signs internal-track builds, and both have to verify.
  // Comma-separated in the env var.
  const fingerprints = [
    ...new Set(
      (process.env.ANDROID_CERT_SHA256 ?? "")
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter((value) => FINGERPRINT_PATTERN.test(value))
    ),
  ];

  // Nothing usable, so serve no document at all. A statement with a wrong or
  // half-typed fingerprint fails verification silently and Android backs off
  // for a long while before it asks again.
  if (fingerprints.length === 0) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: PACKAGE_NAME,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": CACHE_CONTROL,
      },
    }
  );
}
