import { View, type ViewProps } from "react-native";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** Hearth card: warm surface, hairline border, soft shadow. */
export function Card({
  padded = true,
  style,
  ...props
}: ViewProps & { padded?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: theme.border,
          padding: padded ? 16 : 0,
          shadowColor: "#3e2c18",
          shadowOpacity: 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        },
        style,
      ]}
      {...props}
    />
  );
}
