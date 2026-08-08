import { Text, type TextProps, type TextStyle } from "react-native";
import { fonts } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type Variant =
  | "display" // Bricolage bold — screen titles
  | "title" // Bricolage semibold — card/section titles
  | "body"
  | "bodyMedium"
  | "bodySemi"
  | "caption" // small muted metadata
  | "label"; // small semibold

const VARIANTS: Record<Variant, TextStyle> = {
  display: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34 },
  title: { fontFamily: fonts.displaySemi, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  bodyMedium: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 21 },
  bodySemi: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 21 },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: fonts.bodySemi, fontSize: 12, lineHeight: 16 },
};

export function AppText({
  variant = "body",
  muted = false,
  style,
  ...props
}: TextProps & { variant?: Variant; muted?: boolean }) {
  const theme = useTheme();
  return (
    <Text
      style={[
        VARIANTS[variant],
        { color: muted ? theme.muted : theme.foreground },
        style,
      ]}
      {...props}
    />
  );
}
