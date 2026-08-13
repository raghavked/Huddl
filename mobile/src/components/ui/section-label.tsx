import Feather from "@expo/vector-icons/Feather";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { AppText } from "./app-text";

/**
 * The quiet uppercase heading that carries a scrolling screen's rhythm.
 *
 * 24 above, 12 below, `letterSpacing: 1.2`, muted. Always, on every screen.
 * The consistency is the whole point: a student scrolling home, a course, and
 * a club in the same minute should feel one hand behind all three. Do not
 * hand-roll a variant with different margins.
 *
 * It labels a *group of rows*, so keep it to one or two plain words
 * ("Today", "Your courses", "Coming up"). It is not a kicker or an eyebrow:
 * it never sits above a display title dressing it up.
 *
 * `action` is the optional "see all" on the right: brand-colored, a chevron,
 * and a 44px tap area built from `hitSlop` so the text stays small.
 *
 * `first` drops the top margin for the label that opens a screen, where 24px
 * of air under the title would already be there.
 *
 * ```tsx
 * <SectionLabel text="Coming up" action={{ label: "See all", onPress: openPlan }} />
 * ```
 */
export function SectionLabel({
  text,
  action,
  first = false,
  style,
}: {
  text: string;
  action?: { label: string; onPress: () => void };
  first?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginTop: first ? 4 : 24,
          marginBottom: 12,
        },
        style,
      ]}
    >
      <AppText
        variant="label"
        muted
        numberOfLines={1}
        style={{ textTransform: "uppercase", letterSpacing: 1.2, flexShrink: 1 }}
      >
        {text}
      </AppText>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <AppText variant="label" style={{ color: theme.brand }}>
            {action.label}
          </AppText>
          <Feather name="chevron-right" size={14} color={theme.brand} />
        </Pressable>
      ) : null}
    </View>
  );
}
