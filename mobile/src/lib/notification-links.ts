import type { Href } from "expo-router";

/**
 * Notification links are written in the web app's URL space; map the ones
 * with a native twin onto our routes. Query strings and fragments are
 * ignored. Anything unmapped returns null so callers can stay quiet.
 *
 * Shared by the notifications inbox (tap-to-open) and the push tap router
 * in the root layout — one link language, one mapping.
 */
export function routeForLink(link: string | null): Href | null {
  if (!link) return null;
  const match = /^\/(messages|events|courses|channels|clubs)\/([^/?#]+)/.exec(
    link
  );
  const id = match?.[2];
  if (!match || !id) return null;
  switch (match[1]) {
    case "messages":
      return `/dm/${id}`;
    case "events":
      return `/event/${id}`;
    case "courses":
      return `/course/${id}`;
    case "channels":
      return `/channel/${id}`;
    // The web writes `/clubs/<id>`; ours is singular.
    case "clubs":
      return `/club/${id}`;
    default:
      return null;
  }
}
