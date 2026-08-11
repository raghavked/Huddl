import type { Href } from "expo-router";

/**
 * Notification links are written in the web app's URL space; map the ones
 * with a native twin onto our routes. Anything unmapped returns null so
 * callers can stay quiet.
 *
 * Fragments and query strings are dropped, with one deliberate exception:
 * the thread-reply trigger writes `/channels/<id>?thread=<parent id>`, and
 * the room deliberately keeps replies out of the main list — so that link
 * carries through to the thread screen rather than landing somewhere the
 * reply isn't.
 *
 * Shared by the notifications inbox (tap-to-open) and the push tap router
 * in the root layout — one link language, one mapping.
 */

/**
 * Web paths that stand on their own — no id, one native screen each. Every
 * one of these is written by a database trigger, so the list is closed.
 */
const STANDALONE: Record<string, Href | undefined> = {
  // Due-date reminders, the weekly digest and the weekly recap all land here.
  "/plan": "/plan",
  // The batched push digest points back at the inbox itself.
  "/notifications": "/notifications",
  // Privacy is a top-level screen on native, not a settings sub-page.
  "/settings/privacy": "/privacy-settings",
};

/** The parent message id in a `?thread=` query, if the link carries one. */
function threadParam(query: string): string | null {
  const match = /(?:^|&)thread=([^&]+)/.exec(query);
  const raw = match?.[1];
  if (!raw) return null;
  const id = decodeURIComponent(raw);
  return id.length > 0 ? id : null;
}

export function routeForLink(link: string | null): Href | null {
  if (!link) return null;
  const [beforeHash = ""] = link.split("#");
  const [rawPath = "", query = ""] = beforeHash.split("?");
  // A trailing slash is the same screen; "/" itself maps to nothing.
  const path = rawPath.length > 1 ? rawPath.replace(/\/$/, "") : rawPath;

  const standalone = STANDALONE[path];
  if (standalone) return standalone;

  const match = /^\/(messages|events|courses|channels|clubs|u)\/([^/]+)/.exec(
    path
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
    case "channels": {
      // "Maya replied to your message" is about a reply the room never
      // shows — take her to the thread, not the bottom of the channel.
      const parentId = threadParam(query);
      return parentId
        ? {
            pathname: "/channel/thread",
            params: { channelId: id, messageId: parentId },
          }
        : `/channel/${id}`;
    }
    // The web writes `/clubs/<id>`; ours is singular.
    case "clubs":
      return `/club/${id}`;
    // Profiles share a path on both sides — `/u/<handle>`.
    case "u":
      return `/u/${id}`;
    default:
      return null;
  }
}
