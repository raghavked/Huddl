import { useColorScheme, View, type ViewProps } from "react-native";
import { elevationFor, radius, type ElevationStep } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Hearth card: warm surface, hairline border, warm low shadow.
 *
 * The default `rest` elevation is what almost everything wants. Step up only
 * when the card genuinely left the page: `raised` for a menu or a popover,
 * `floating` for a bottom sheet or a modal. In dark the same steps lean on
 * surface contrast instead of shadow — see the `elevation` token docs.
 */
export function Card({
  padded = true,
  elevation = "rest",
  style,
  ...props
}: ViewProps & { padded?: boolean; elevation?: ElevationStep }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: theme.border,
          padding: padded ? 16 : 0,
          ...elevationFor(scheme)[elevation],
        },
        style,
      ]}
      {...props}
    />
  );
}
