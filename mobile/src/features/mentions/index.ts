/* Mentions in chat: MentionText highlights @handle tokens inside a rendered
   message (and containsMention tells you if a message mentions someone), while
   useMentionSuggestions powers the composer's @-autocomplete strip. The
   mention notification itself fires from a database trigger on insert. The
   client only renders and suggests. */

export {
  MentionText,
  containsMention,
  type MentionTextProps,
} from "./mention-text";
export {
  useMentionSuggestions,
  type MentionSuggestion,
  type MentionSuggestionsApi,
} from "./use-mention-suggestions";
