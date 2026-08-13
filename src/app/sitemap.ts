import type { MetadataRoute } from "next";
import { isProtectedPath, PUBLIC_PATHS } from "@/lib/protected-routes";

const siteUrl = process.env.SITE_URL ?? "https://huddl.app";

/** How eagerly a crawler should come back, per public page. */
const WEIGHT: Record<string, { priority: number; changeFrequency: "weekly" | "monthly" }> = {
  "/": { priority: 1, changeFrequency: "weekly" },
  "/signup": { priority: 0.8, changeFrequency: "monthly" },
  "/login": { priority: 0.5, changeFrequency: "monthly" },
};

const DEFAULT_WEIGHT = { priority: 0.3, changeFrequency: "monthly" as const };

/**
 * Only the public pages. Everything behind auth is out of the index.
 *
 * Built from the same `PUBLIC_PATHS` that robots.txt allows, so the two can't
 * disagree about a page: advertising something in the sitemap that robots.txt
 * forbids is the classic way to get a page de-indexed and never find out.
 * The assertion below is belt and braces on top of that.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_PATHS.map((path) => {
    if (isProtectedPath(path)) {
      // Unreachable unless someone lists a page as both public and private;
      // failing the build beats quietly submitting a login redirect to Google.
      throw new Error(`sitemap: ${path} is in PUBLIC_PATHS but is protected`);
    }
    const weight = WEIGHT[path] ?? DEFAULT_WEIGHT;
    return {
      url: path === "/" ? siteUrl : `${siteUrl}${path}`,
      lastModified,
      changeFrequency: weight.changeFrequency,
      priority: weight.priority,
    };
  });
}
