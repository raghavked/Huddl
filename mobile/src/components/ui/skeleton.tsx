import { useEffect, useRef } from "react";
import {
  Animated,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { motion, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { Card } from "./card";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * A ghost block for the first paint of a screen whose shape you already know.
 *
 * **No shimmer.** A sweeping highlight is decoration, and the hearth rule is
 * that motion reports arrival or completion. A loading state is neither.
 * The default is a still `surface2` block: the page looks like itself with
 * the words not yet written, which is calmer and reads better in dark.
 *
 * `pulse` opts one screen into a gentle opacity breath (320ms each way, the
 * reversible curve) for the rare case where a long wait needs a sign of
 * life. It turns itself off under reduce motion.
 *
 * Use skeletons where you can honestly predict the layout: a list of rows,
 * a profile header. Where you cannot, a centered `ActivityIndicator` in
 * `theme.brand` is the more honest loading state.
 *
 * ```tsx
 * <Skeleton width="60%" height={14} radius={radius.full} />
 * ```
 */
export function Skeleton({
  width = "100%",
  height = 14,
  radius: corner = radius.control,
  pulse = false,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  /** Defaults to `radius.control`; pass `radius.full` for text lines. */
  radius?: number;
  pulse?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse || reduceMotion) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: motion.slow,
          easing: motion.easing.standard,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: motion.slow,
          easing: motion.easing.standard,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      opacity.setValue(1);
    };
  }, [pulse, reduceMotion, opacity]);

  return (
    <Animated.View
      // Placeholders are furniture, not content, so keep them out of the
      // screen reader's way entirely.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: corner,
          backgroundColor: theme.surface2,
          opacity,
        },
        style,
      ]}
    />
  );
}

/**
 * A card-shaped placeholder for one row of a list: the shape most Hearth
 * lists actually have (avatar, a title line, a metadata line).
 *
 * Render three or four while the query is in flight, then swap in the real
 * rows. Matching the real row's 68px min-height and 10px gap keeps the page
 * from jumping when the data lands.
 *
 * ```tsx
 * {loading ? [0, 1, 2].map((i) => <SkeletonRow key={i} />) : rows.map(renderRow)}
 * ```
 */
export function SkeletonRow({
  avatar = true,
  lines = 2,
  pulse = false,
}: {
  avatar?: boolean;
  /** 1 for a plain title row, 2 for title + metadata (the default). */
  lines?: number;
  pulse?: boolean;
}) {
  const widths: DimensionValue[] = ["62%", "40%", "52%"];
  return (
    <Card
      padded={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        minHeight: 68,
        marginBottom: 10,
      }}
    >
      {avatar ? (
        <Skeleton width={44} height={44} radius={radius.full} pulse={pulse} />
      ) : null}
      <View style={{ flex: 1, gap: 8 }}>
        {Array.from({ length: Math.max(1, lines) }, (_, index) => (
          <Skeleton
            key={index}
            width={widths[index % widths.length]}
            height={index === 0 ? 14 : 11}
            radius={radius.full}
            pulse={pulse}
          />
        ))}
      </View>
    </Card>
  );
}
