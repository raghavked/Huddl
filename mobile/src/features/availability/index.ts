/* Availability polls in the chat stream: "when can everyone meet?", answered
   yes / maybe / no by everyone in the channel, with the winning time ready to
   become a study session.
 *
 * Two pieces, both self-contained, both shaped like their poll siblings in
 * `@/features/polls` so the room adopts them the same way:
 *
 * ```tsx
 * import { AvailabilityBubble, AvailabilityComposer } from "@/features/availability";
 *
 * // …wherever the room knows a message announces a poll:
 * <AvailabilityBubble pollId={pollId} />
 *
 * // …and once, near the message bar:
 * <AvailabilityComposer
 *   channelId={channelId}
 *   visible={askingWhen}
 *   onClose={() => setAskingWhen(false)}
 *   onCreated={(pollId) => rememberPoll(pollId)}
 * />
 * ```
 *
 * ONE INTEGRATION NOTE, because it differs from polls: migration 0033 gave
 * `messages` no `availability_poll_id` column. The RPC posts an ordinary
 * message reading `When can everyone meet? <title>`, so the room has to
 * resolve poll ids itself: one `availability_polls` query per channel
 * (filtered by `channel_id`, matched to the announcing message by author and
 * `created_at` proximity), plus the id `onCreated` hands back for a poll the
 * student just started. The bubble takes it from there.
 */

export {
  AvailabilityBubble,
  type AvailabilityBubbleProps,
} from "./availability-bubble";
export {
  AvailabilityComposer,
  type AvailabilityComposerProps,
} from "./availability-composer";
