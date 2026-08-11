import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps, ComponentType } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import type { IllustrationProps } from "@/components/illustrations";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { AppText } from "./app-text";
import { Button } from "./button";
import { Card } from "./card";

type FeatherName = ComponentProps<typeof Feather>["name"];

/**
 * The dashed card that stands in for a list with nothing in it.
 *
 * An empty state in Huddl does one of two jobs and should say which in its
 * first three words: it **recruits** ("Be the first — add a course and its
 * chat opens for everyone in it") or it **reassures** ("You haven't blocked
 * anyone. Hopefully it stays that way"). Never "No data found."
 *
 * Pick one mark, not both:
 * - `illustration` — a hand-drawn component from `@/components/illustrations`
 *   (Mug, Doorway, PaperPlane, Pennant, Lantern, PinnedNote, WallCalendar,
 *   MagnifyingGlass, Tray, Shoebox). Use it on the empties a student will
 *   actually meet: the front door, an empty inbox, a search that found
 *   nothing. Pick the one whose *mood* is true — the doc comment on each
 *   names it. It gets its colors from the theme here, so just pass the
 *   component: `illustration={Mug}`.
 * - `icon` — a Feather name in a soft ember tile. The workhorse for the
 *   dozens of smaller empties inside a room.
 *
 * `action` is the way out. If the reader can fix the emptiness themselves,
 * give them the button; if they cannot (nobody has posted yet), leave it off
 * rather than inventing a dead-end tap.
 *
 * `compact` shrinks the whole thing for an empty section nested inside a
 * screen that already has content above it.
 *
 * ```tsx
 * <EmptyState
 *   icon="book-open"
 *   title="No courses yet"
 *   body="Add your classes and each one comes with a chat full of your classmates."
 *   action={{ label: "Add your courses", onPress: openAdd }}
 * />
 * ```
 */
export function EmptyState({
  title,
  body,
  icon,
  illustration: Illustration,
  action,
  compact = false,
  style,
}: {
  title: string;
  /** One or two sentences. Almost always worth writing. */
  body?: string;
  icon?: FeatherName;
  illustration?: ComponentType<IllustrationProps>;
  action?: { label: string; onPress: () => void };
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const tile = compact ? 34 : 40;

  return (
    <Card
      style={[
        {
          alignItems: "center",
          gap: 6,
          paddingVertical: compact ? 18 : 28,
          borderStyle: "dashed",
        },
        style,
      ]}
    >
      {Illustration ? (
        <Illustration
          size={compact ? 56 : 72}
          color={theme.muted}
          softColor={theme.surface2}
        />
      ) : icon ? (
        <View
          style={{
            width: tile,
            height: tile,
            borderRadius: radius.full,
            backgroundColor: theme.brandSoft,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 2,
          }}
        >
          <Feather name={icon} size={compact ? 16 : 18} color={theme.brand} />
        </View>
      ) : null}

      <AppText variant="bodySemi" style={{ textAlign: "center" }}>
        {title}
      </AppText>

      {body ? (
        <AppText
          variant="caption"
          muted
          style={{ textAlign: "center", maxWidth: compact ? 260 : 280 }}
        >
          {body}
        </AppText>
      ) : null}

      {action ? (
        <Button
          label={action.label}
          variant="soft"
          size="sm"
          style={{ marginTop: 6 }}
          onPress={action.onPress}
        />
      ) : null}
    </Card>
  );
}
