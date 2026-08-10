import { useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type ViewStyle,
} from "react-native";
import { fonts, motion, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { AppText } from "./app-text";
import { useReducedMotion } from "./use-reduced-motion";

type Variant = "primary" | "secondary" | "soft" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const HEIGHTS: Record<Size, number> = { sm: 38, md: 46, lg: 52 };
const PAD: Record<Size, number> = { sm: 16, md: 20, lg: 26 };

/* Pressing sinks the button 2% into the page and dims it a shade — the
   press-out retraces the same curve, because a press is reversible. Under
   reduce motion the scale stays put and the dim lands instantly. */
const PRESSED_SCALE = 0.98;
const PRESSED_OPACITY = 0.85;
const DISABLED_OPACITY = 0.6;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  label,
  variant = "primary",
  size = "md",
  pending = false,
  disabled,
  icon,
  style,
  onPressIn,
  onPressOut,
  ...props
}: Omit<PressableProps, "children"> & {
  label: string;
  variant?: Variant;
  size?: Size;
  pending?: boolean;
  icon?: React.ReactNode;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const press = useRef(new Animated.Value(0)).current;

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

  /* One driver, two outputs — the animated node set never changes shape
     between renders, so the native driver stays happy. */
  const feedback = useMemo(() => {
    const resting = isDisabled ? DISABLED_OPACITY : 1;
    return {
      opacity: press.interpolate({
        inputRange: [0, 1],
        outputRange: [resting, isDisabled ? resting : PRESSED_OPACITY],
      }),
      scale: press.interpolate({
        inputRange: [0, 1],
        outputRange: [1, reduceMotion ? 1 : PRESSED_SCALE],
      }),
    };
  }, [press, isDisabled, reduceMotion]);

  const drive = (toValue: number) => {
    Animated.timing(press, {
      toValue,
      duration: reduceMotion ? motion.instant : motion.quick,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPressIn={(event: GestureResponderEvent) => {
        drive(1);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        drive(0);
        onPressOut?.(event);
      }}
      style={[
        {
          height: HEIGHTS[size],
          paddingHorizontal: PAD[size],
          borderRadius: radius.full,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        },
        fill[variant],
        { opacity: feedback.opacity, transform: [{ scale: feedback.scale }] },
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
    </AnimatedPressable>
  );
}
