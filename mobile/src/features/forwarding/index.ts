/* Forwarding in the chat stream: passing a message along to another room with
   its provenance intact: the new room sees the words plus a quiet line saying
   who wrote them and where they came from. `@/lib/forwarding` is the data
   layer underneath (targets, the write, the copy helpers); this module is what
   a room renders.
 *
 * All three rooms (a channel, a thread of replies, a conversation) forward,
 * and they forward identically: the same picker over the same targets, the
 * same provenance line above a forwarded bubble. So the pieces live here once
 * and each room passes in what differs.
 *
 * ```tsx
 * import {
 *   ForwardPicker,
 *   ForwardedFrom,
 *   PendingBubble,
 * } from "@/features/forwarding";
 *
 * // …above the words of any message carrying a forwarded_from:
 * <ForwardedFrom from={m.forwarded_from} who={originalAuthorName} own={isOwn} />
 *
 * // …and once, at the root of the screen, outside any Modal:
 * <ForwardPicker
 *   visible={forwardFor !== null}
 *   source={forwardSource}
 *   exclude={{ kind: "channel", id: channelId }}
 *   blocked={blocked}
 *   liftForKeyboard
 *   onClose={() => setForwardFor(null)}
 *   onFinished={showForwardNote}
 * />
 * ```
 *
 * ONE THING THAT ISN'T FORWARDING: `PendingBubble` draws a message the send
 * queue in `@/lib/drafts` is still holding. It lives here because the same
 * three rooms are its only callers and it was triplicated alongside the rest;
 * it shares no data path with the forwarding above it. If a fourth surface
 * ever queues messages without forwarding them, that's the moment to give the
 * outgoing queue its own module and move this one file into it.
 */

export {
  ForwardPicker,
  FORWARD_MAX_TARGETS,
  type ForwardPickerProps,
} from "./forward-picker";
export { ForwardedFrom, type ForwardedFromProps } from "./forwarded-from";
export { PendingBubble, type PendingBubbleProps } from "./pending-bubble";
