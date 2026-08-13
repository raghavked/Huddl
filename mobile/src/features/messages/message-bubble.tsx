import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { Card } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type MessageBubbleProps = {
  /** True when the signed-in student wrote it: the ember-washed side. */
  own: boolean;
  /** A tombstone: dashed outline, no fill, whatever the caller puts inside. */
  deleted?: boolean;
  /** Ringed because she was just sent here from saved, search, or a link. */
  highlighted?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * The message bubble: one shape for every room.
 *
 * A course chat, a thread and a DM are the three surfaces a student moves
 * between hourly, and until this existed they drew the same object three
 * ways: two radii, two paddings, a border on two of them and a tail on the
 * third. This is the single drawing: `radius.card`, a hairline, the `rest`
 * elevation `Card` already carries, and the ember/paper pair that says whose
 * words these are.
 *
 * It is the container only. What goes inside stays with the room, because
 * that genuinely differs (a channel renders `MentionText` and a forwarded
 * provenance line, a DM renders plain text), and folding those in would make
 * this a switch statement wearing a component's name.
 */
export function MessageBubble({
  own,
  deleted = false,
  highlighted = false,
  style,
  children,
}: MessageBubbleProps) {
  const theme = useTheme();
  return (
    <Card
      padded={false}
      style={[
        {
          borderRadius: radius.card,
          paddingHorizontal: 12,
          paddingVertical: 8,
          gap: 6,
          backgroundColor: deleted
            ? "transparent"
            : own
              ? theme.brandSoft
              : theme.surface2,
          borderColor: highlighted ? theme.brand : theme.border,
          ...(deleted ? { borderStyle: "dashed" as const } : null),
        },
        style,
      ]}
    >
      {children}
    </Card>
  );
}
