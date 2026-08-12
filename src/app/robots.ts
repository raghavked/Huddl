import type { MetadataRoute } from "next";
import { PROTECTED_PREFIXES, PUBLIC_PATHS } from "@/lib/protected-routes";

const siteUrl = process.env.SITE_URL ?? "https://huddl.app";

/**
 * Crawlers get the marketing surface; the signed-in app stays private.
 *
 * Both lists come from `lib/protected-routes` rather than being retyped here.
 * They had drifted: eight routes added after launch — /board, /saved, /focus,
 * /plan, /semester, /calendar, /decks, /moderation — were private in the app
 * and absent from this file, so crawlers were free to walk them. Nothing
 * leaks, because they redirect to /login, but a crawler that has walked them
 * knows the shape of the signed-in app and will index the redirects under
 * paths that read like a student's own.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [...PUBLIC_PATHS],
      disallow: [...PROTECTED_PREFIXES],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
