import { ScrollView, View, type ViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

/** Standard screen scaffold: safe-area padding, display title, content. */
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
        gap: 12,
        marginBottom: 16,
      }}
    >
      <AppText variant="display">{title}</AppText>
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
            paddingTop: insets.top + 12,
            paddingHorizontal: 20,
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
        paddingTop: insets.top + 12,
        paddingHorizontal: 20,
        paddingBottom: 32,
      }}
    >
      {header}
      {children}
    </ScrollView>
  );
}
