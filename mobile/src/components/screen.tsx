import { ScrollView, View, type ViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "@/components/ui";
import { space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * The standard screen scaffold: safe-area padding, a display title, content.
 *
 * This is where most of the app gets its air, so the numbers here are the
 * `space` ladder rather than literals — `gutter` down both edges, `chapter`
 * under the title, and `rest` at the foot of a scroll so the last card isn't
 * pinned against the home indicator.
 *
 * The title sits `chapter` above the content rather than `card`. A screen
 * title is the start of a new thought and wants the same air a section
 * heading gets; the old 16 read as a caption attached to the first card.
 *
 * `insets.top + close` is the one deliberate literal-ish value: it hangs off
 * the notch rather than off the ladder, and 12 is what puts a 28px display
 * line optically level with a 44px back chevron on the screens that have one.
 */
export function Screen({
  title,
  action,
  scroll = true,
  children,
  style,
  ...props
}: ViewProps & {
  title: string;
  action?: React.ReactNode;
  scroll?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const header = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: space.close,
        marginBottom: space.chapter,
      }}
    >
      <AppText variant="display" style={{ flex: 1 }} numberOfLines={2}>
        {title}
      </AppText>
      {action}
    </View>
  );

  if (!scroll) {
    return (
      <View
        style={[
          {
            flex: 1,
            backgroundColor: theme.background,
            paddingTop: insets.top + space.close,
            paddingHorizontal: space.gutter,
          },
          style,
        ]}
        {...props}
      >
        {header}
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        paddingTop: insets.top + space.close,
        paddingHorizontal: space.gutter,
        paddingBottom: insets.bottom + space.rest,
      }}
    >
      {header}
      {children}
    </ScrollView>
  );
}
