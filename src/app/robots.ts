import type { MetadataRoute } from "next";

const siteUrl = process.env.SITE_URL ?? "https://huddl.app";

/** Crawlers get the marketing surface; the signed-in app stays private. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/login", "/signup"],
      disallow: [
        "/home",
        "/channels",
        "/messages",
        "/clubs",
        "/events",
        "/courses",
        "/people",
        "/settings",
        "/setup",
        "/onboarding",
        "/notifications",
        "/u/",
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
