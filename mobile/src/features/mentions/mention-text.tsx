import { useMemo } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { fonts } from "@/constants/theme";

/**
 * The mention token shape shared by the renderer and the server-side
 * notification trigger: an `@` followed by 3–24 handle characters
 * (letters, digits, underscore). The capture group means `String.split`
 * interleaves the captured handles into the result at odd indices.
 */
const MENTION_SPLIT = /@([a-z0-9_]{3,24})/gi;

/** Props for {@link MentionText}. */
export type MentionTextProps = {
  /** The raw message content to render (e.g. `messages.content`). */
  text: string;
  /**
   * Style for the non-mention text. Pass whatever the plain message text
   * currently uses (font, size, color). Mention tokens inherit everything
   * from it except `fontFamily` and `color`, which they override.
   */
  baseStyle?: StyleProp<TextStyle>;
  /**
   * Color for mention tokens. Pick per bubble so contrast holds, e.g.
   * `theme.brandInk` on other people's bubbles and `theme.onSolid` (or the
   * bubble's own text color) on your own brand-colored bubble.
   */
  highlightColor: string;
  /** Forwarded to the outer `Text`. Same truncation behavior as before. */
  numberOfLines?: number;
};

/**
 * Message content with `@handle` tokens highlighted. Drop-in replacement for
 * the plain `Text`/`AppText` that renders a message body: it splits the text
 * on mention tokens and renders them semibold in `highlightColor`, leaving
 * every other segment styled by `baseStyle` alone.
 *
 * Pure display: no network, no navigation, no touch handling. The mention
 * notification already fires from a database trigger on message insert, so
 * rendering is the only client-side job.
 *
 * ```tsx
 * <MentionText
 *   text={message.content}
 *   baseStyle={{ fontFamily: fonts.body, fontSize: 15, color: theme.foreground }}
 *   highlightColor={theme.brandInk}
 *   numberOfLines={isPreview ? 2 : undefined}
 * />
 * ```
 */
export function MentionText({
  text,
  baseStyle,
  highlightColor,
  numberOfLines,
}: MentionTextProps) {
  // Odd indices are captured handles (without the "@"), even indices are the
  // plain text between them.
  const segments = useMemo(() => text.split(MENTION_SPLIT), [text]);

  return (
    <Text style={baseStyle} numberOfLines={numberOfLines}>
      {segments.map((segment, index) => {
        if (index % 2 === 1) {
          return (
            <Text
              // Segments are positional; the list only changes when `text` does.
              key={`m-${index}`}
              style={{ fontFamily: fonts.bodySemi, color: highlightColor }}
            >
              {`@${segment}`}
            </Text>
          );
        }
        if (segment.length === 0) return null;
        return <Text key={`t-${index}`}>{segment}</Text>;
      })}
    </Text>
  );
}

/**
 * Whether `text` mentions `handle` as a whole token, using the exact same
 * tokenization {@link MentionText} highlights, so "does this message mention
 * me" always agrees with what the user sees. Case-insensitive; a leading `@`
 * on `handle` is tolerated. Partial matches don't count: `"hi @samantha"`
 * does NOT contain a mention of `"sam"`.
 *
 * Useful for styling a message row that mentions the signed-in user (e.g. a
 * soft tinted background) without re-parsing the text yourself.
 */
export function containsMention(text: string, handle: string): boolean {
  const target = (
    handle.startsWith("@") ? handle.slice(1) : handle
  ).toLowerCase();
  if (target.length === 0) return false;
  const segments = text.split(MENTION_SPLIT);
  for (let i = 1; i < segments.length; i += 2) {
    if ((segments[i] ?? "").toLowerCase() === target) return true;
  }
  return false;
}
