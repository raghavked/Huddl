import type { MetadataRoute } from "next";

const siteUrl = process.env.SITE_URL ?? "https://huddl.app";

/** Only the public pages — everything behind auth is out of the index. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: siteUrl,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/signup`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/login`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    ...["terms", "privacy", "guidelines"].map((slug) => ({
      url: `${siteUrl}/legal/${slug}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.3,
    })),
  ];
}
