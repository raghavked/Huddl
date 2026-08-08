import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  type ViewStyle,
} from "react-native";
import { fonts, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { AppText } from "./app-text";

type Variant = "primary" | "secondary" | "soft" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const HEIGHTS: Record<Size, number> = { sm: 38, md: 46, lg: 52 };
const PAD: Record<Size, number> = { sm: 16, md: 20, lg: 26 };

export function Button({
  label,
  variant = "primary",
  size = "md",
  pending = false,
  disabled,
  icon,
  style,
  ...props
}: Omit<PressableProps, "children"> & {
  label: string;
  variant?: Variant;
  size?: Size;
  pending?: boolean;
  icon?: React.ReactNode;
}) {
  const theme = useTheme();

  const fill: Record<Variant, ViewStyle> = {
    primary: { backgroundColor: theme.brand },
    secondary: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    soft: { backgroundColor: theme.brandSoft },
    ghost: { backgroundColor: "transparent" },
    danger: { backgroundColor: theme.danger },
  };
  const text: Record<Variant, string> = {
    primary: theme.brandFg,
    secondary: theme.foreground,
    soft: theme.brandInk,
    ghost: theme.muted,
    danger: theme.onSolid,
  };

  const isDisabled = disabled || pending;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          height: HEIGHTS[size],
          paddingHorizontal: PAD[size],
          borderRadius: radius.full,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          opacity: isDisabled ? 0.6 : pressed ? 0.85 : 1,
        },
        fill[variant],
        typeof style === "function" ? undefined : style,
      ]}
      {...props}
    >
      {pending ? (
        <ActivityIndicator size="small" color={text[variant]} />
      ) : (
        icon
      )}
      <AppText
        variant="bodySemi"
        style={{
          color: text[variant],
          fontFamily: fonts.bodySemi,
          fontSize: size === "sm" ? 13 : 15,
        }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}
