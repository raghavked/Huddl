/* @Mention helpers — pure string logic, unit tested. The server side
   (migration 0019) notifies any channel member whose handle appears as
   `@handle` in a new message; these helpers keep the client's autocomplete
   and highlighting in step with that trigger's `@([a-z0-9_]{3,24})` match. */

/** Handles are 3-24 chars of [a-z0-9_] — same shape the DB trigger scans. */
const HANDLE_BODY = "[a-z0-9_]";

export type MentionSegment = { text: string; mention: boolean };

/**
 * Split message content into plain and `@handle` segments for rendering.
 * Mirrors the notify trigger: any `@` followed by 3-24 handle chars counts.
 */
export function splitMentions(content: string): MentionSegment[] {
  const re = new RegExp(`@${HANDLE_BODY}{3,24}`, "gi");
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of content.matchAll(re)) {
    const start = match.index;
    if (start > last) {
      segments.push({ text: content.slice(last, start), mention: false });
    }
    segments.push({ text: match[0], mention: true });
    last = start + match[0].length;
  }
  if (last < content.length || segments.length === 0) {
    segments.push({ text: content.slice(last), mention: false });
  }
  return segments;
}

/**
 * The partial handle being typed at the caret — `"jo"` for `"hey @jo"`,
 * `""` right after `@`, or null when the caret isn't inside an @-token.
 * The `@` must start the text or follow whitespace so emails don't trigger
 * the picker mid-word.
 */
export function mentionQuery(textBeforeCaret: string): string | null {
  const match = new RegExp(`(?:^|\\s)@(${HANDLE_BODY}{0,24})$`, "i").exec(
    textBeforeCaret
  );
  return match ? match[1].toLowerCase() : null;
}

export type MentionCandidate = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
};

/**
 * Rank channel members against the typed partial: handle/name prefix
 * matches first, then substring matches, capped at `max`. An empty query
 * (right after `@`) offers the first members as-is.
 */
export function filterMentionCandidates(
  members: MentionCandidate[],
  query: string,
  excludeId?: string,
  max = 5
): MentionCandidate[] {
  const q = query.toLowerCase();
  const pool = members.filter((m) => m.id !== excludeId);
  const starts: MentionCandidate[] = [];
  const contains: MentionCandidate[] = [];
  for (const member of pool) {
    const handle = member.handle.toLowerCase();
    const name = member.display_name.toLowerCase();
    if (handle.startsWith(q) || name.startsWith(q)) starts.push(member);
    else if (handle.includes(q) || name.includes(q)) contains.push(member);
  }
  return [...starts, ...contains].slice(0, max);
}

/**
 * Replace the @-token at the caret with `@handle ` and report where the
 * caret should land. No-op if the caret isn't inside an @-token.
 */
export function insertMention(
  draft: string,
  caret: number,
  handle: string
): { next: string; caret: number } {
  const before = draft.slice(0, caret);
  const match = new RegExp(`(?:^|\\s)@(${HANDLE_BODY}{0,24})$`, "i").exec(
    before
  );
  if (!match) return { next: draft, caret };
  const atIndex = caret - match[1].length - 1;
  const inserted = `@${handle} `;
  return {
    next: draft.slice(0, atIndex) + inserted + draft.slice(caret),
    caret: atIndex + inserted.length,
  };
}
