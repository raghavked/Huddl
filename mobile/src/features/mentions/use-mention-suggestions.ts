import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * One tappable row in the mention autocomplete: a channel member who matches
 * what the user has typed after `@`.
 */
export type MentionSuggestion = {
  /** The member's user id (`profiles.id`). */
  id: string;
  /** The member's handle, without the `@`: what gets inserted in the draft. */
  handle: string;
  /** The member's display name. Show it next to the handle in the row. */
  displayName: string;
};

/** What {@link useMentionSuggestions} returns. */
export type MentionSuggestionsApi = {
  /**
   * True while the draft ends in a mention token being typed (`@` plus up to
   * 24 handle characters). Show the suggestion strip when this is true and
   * `suggestions` is non-empty; hide it otherwise.
   */
  active: boolean;
  /**
   * Up to 5 channel members whose handle OR display name starts with the
   * partial the user has typed (case-insensitive). Right after a bare `@`
   * the partial is empty, so this holds the first 5 members. Empty array
   * whenever `active` is false.
   */
  suggestions: MentionSuggestion[];
  /**
   * Call on every composer text change, with the full draft, alongside your
   * own `setDraft`. It watches for a trailing `@partial` token and flips
   * `active`/`suggestions` accordingly. Cheap and synchronous, with no I/O.
   */
  onDraftChange: (draft: string) => void;
  /**
   * Call when the user taps a suggestion. Replaces the trailing `@partial`
   * token in `draft` with `@handle ` (trailing space included, ready to keep
   * typing) and returns the new draft. Set that as your composer value. Also
   * deactivates the suggestion strip. If the draft no longer ends in a
   * mention token it is returned unchanged.
   */
  applyMention: (draft: string, handle: string) => string;
  /**
   * Hide the strip without touching the draft. Call it after sending a
   * message, or when the composer loses focus or dismisses.
   */
  reset: () => void;
};

/** A mention token still being typed at the end of the draft. */
const TRAILING_MENTION = /@([a-z0-9_]{0,24})$/i;

const MAX_SUGGESTIONS = 5;

/**
 * Best-effort normalization of the joined rows. The client is untyped, and
 * PostgREST can hand the embedded `profiles` back as an object or a
 * one-element array depending on how it resolves the relationship. Accept
 * both, and drop any row missing an id or handle.
 */
function normalizeMembers(rows: unknown): MentionSuggestion[] {
  if (!Array.isArray(rows)) return [];
  const out: MentionSuggestion[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const embedded = (row as { profiles?: unknown }).profiles;
    const profile: unknown = Array.isArray(embedded) ? embedded[0] : embedded;
    if (typeof profile !== "object" || profile === null) continue;
    const record = profile as Record<string, unknown>;
    const id = record["id"];
    const handle = record["handle"];
    const displayName = record["display_name"];
    if (typeof id !== "string" || typeof handle !== "string") continue;
    if (handle.length === 0) continue;
    out.push({
      id,
      handle,
      displayName:
        typeof displayName === "string" && displayName.length > 0
          ? displayName
          : handle,
    });
  }
  return out;
}

/**
 * Composer-side mention autocomplete for a channel. Loads the channel's
 * member list once per `channelId` (silently: a failed load just means no
 * suggestions, and typing `@handle` by hand still works), then matches a
 * trailing `@partial` token in the draft against member handles and display
 * names.
 *
 * Wiring into a message bar:
 *
 * ```tsx
 * const mentions = useMentionSuggestions(channelId);
 *
 * <TextInput
 *   value={draft}
 *   onChangeText={(next) => {
 *     setDraft(next);
 *     mentions.onDraftChange(next);
 *   }}
 * />
 * {mentions.active && mentions.suggestions.length > 0 ? (
 *   // Render a row strip above the input; each row (44px min height) taps to:
 *   // setDraft(mentions.applyMention(draft, suggestion.handle))
 * ) : null}
 * // After sending: mentions.reset()
 * ```
 *
 * Pass `null` while the channel id is still resolving; the hook stays idle.
 * The mention NOTIFICATION is created server-side by a database trigger when
 * the message row is inserted; the client never writes anything for mentions.
 */
export function useMentionSuggestions(
  channelId: string | null
): MentionSuggestionsApi {
  const [members, setMembers] = useState<MentionSuggestion[]>([]);
  const [active, setActive] = useState(false);
  const [partial, setPartial] = useState("");

  useEffect(() => {
    // New channel, clean slate: no stale strip or member list carries over.
    setMembers([]);
    setActive(false);
    setPartial("");
    if (!channelId) return;

    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("channel_members")
        .select("user_id, profiles(id, handle, display_name)")
        .eq("channel_id", channelId);
      if (cancelled || error) return;
      setMembers(normalizeMembers(data));
    })();
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const onDraftChange = useCallback((draft: string) => {
    const match = TRAILING_MENTION.exec(draft);
    if (match) {
      setActive(true);
      setPartial(match[1] ?? "");
    } else {
      setActive(false);
      setPartial("");
    }
  }, []);

  const applyMention = useCallback(
    (draft: string, handle: string): string => {
      setActive(false);
      setPartial("");
      if (!TRAILING_MENTION.test(draft)) return draft;
      return draft.replace(TRAILING_MENTION, () => `@${handle} `);
    },
    []
  );

  const reset = useCallback(() => {
    setActive(false);
    setPartial("");
  }, []);

  const suggestions = useMemo(() => {
    if (!active) return [];
    const query = partial.toLowerCase();
    const out: MentionSuggestion[] = [];
    for (const member of members) {
      if (
        member.handle.toLowerCase().startsWith(query) ||
        member.displayName.toLowerCase().startsWith(query)
      ) {
        out.push(member);
        if (out.length === MAX_SUGGESTIONS) break;
      }
    }
    return out;
  }, [active, members, partial]);

  return { active, suggestions, onDraftChange, applyMention, reset };
}
