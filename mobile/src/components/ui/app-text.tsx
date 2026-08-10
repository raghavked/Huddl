import { useMemo } from "react";
import { Text, type TextProps, type TextStyle } from "react-native";
import { fonts } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { clampTextScale, useDisplay } from "@/providers/display-provider";

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

/**
 * Grow a variant by the student's type-size preference. Font size and line
 * height move together so the rhythm of a paragraph survives the scaling, and
 * both land on whole pixels. The scale is clamped here as well as in the
 * provider — a bad value read back from storage can never reach layout.
 */
function scaleVariant(variant: Variant, scale: number): TextStyle {
  const base = VARIANTS[variant];
  if (scale === 1) return base;
  return {
    ...base,
    fontSize: Math.round((base.fontSize ?? 15) * scale),
    lineHeight: Math.round((base.lineHeight ?? 21) * scale),
  };
}

export function AppText({
  variant = "body",
  muted = false,
  style,
  ...props
}: TextProps & { variant?: Variant; muted?: boolean }) {
  const theme = useTheme();
  const scale = clampTextScale(useDisplay().textScale);
  const sized = useMemo(() => scaleVariant(variant, scale), [variant, scale]);
  return (
    <Text
      style={[sized, { color: muted ? theme.muted : theme.foreground }, style]}
      {...props}
    />
  );
}
