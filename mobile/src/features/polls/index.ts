/* Polls in the chat stream: a poll is a message with a poll_id. The room
   renders PollBubble wherever a message carries one, and opens PollComposer
   from its message bar to start a new poll. */

export { PollBubble, type PollBubbleProps } from "./poll-bubble";
export { PollComposer, type PollComposerProps } from "./poll-composer";
