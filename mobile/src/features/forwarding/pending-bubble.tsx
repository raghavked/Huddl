import Feather from "@expo/vector-icons/Feather";
import { Pressable, View } from "react-native";
import { AppText, Card } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { QueuedMessage } from "@/lib/drafts";

export type PendingBubbleProps = {
  /** The row still sitting in the send queue, from `@/lib/drafts`. */
  message: QueuedMessage;
  /** Push it at the queue again. Wired to the whole bubble. */
  onRetry: () => void;
  /** Drop it for good — only offered once the queue has called it stuck. */
  onDiscard: () => void;
};

/** A message the send queue is holding: the words stay in the room, a quiet
    caption says why, and a tap tries again. A stuck one also offers a way out. */
export function PendingBubble({
  message,
  onRetry,
  onDiscard,
}: PendingBubbleProps) {
  const theme = useTheme();
  const content = message.payload["content"] ?? "";
  const caption = message.stuck
    ? (message.last_error ?? "We couldn't send this one.")
    : "Waiting to send";
  return (
    <View style={{ marginTop: 10, alignItems: "flex-end" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${caption}. Tap to try again.`}
        onPress={onRetry}
        hitSlop={6}
        style={({ pressed }) => ({
          maxWidth: "80%",
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Card
          padded={false}
          style={{
            backgroundColor: theme.surface2,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: message.stuck ? theme.danger : theme.border,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <AppText style={{ color: theme.foreground }}>{content}</AppText>
        </Card>
      </Pressable>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          marginTop: 3,
          paddingHorizontal: 4,
        }}
      >
        <Feather
          name={message.stuck ? "alert-circle" : "clock"}
          size={11}
          color={message.stuck ? theme.danger : theme.muted}
        />
        <AppText
          variant="caption"
          style={{ color: message.stuck ? theme.danger : theme.muted }}
        >
          {caption}
        </AppText>
        {message.stuck ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard this message"
            onPress={onDiscard}
            hitSlop={14}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <AppText variant="label" style={{ color: theme.brandInk }}>
              Discard
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
