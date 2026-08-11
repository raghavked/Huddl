import { useEffect, useRef } from "react";
import {
  Animated,
  useColorScheme,
  View,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import {
  elevationFor,
  motion,
  radius,
  type ElevationStep,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useReducedMotion } from "./use-reduced-motion";

/* The arrival: eight pixels up and a fade, on the `enter` curve. Rows are
   staggered so a list assembles itself rather than flashing in all at once,
   and the stagger stops climbing after seven of them — nobody should wait a
   second and a half to read row thirty. */
const ENTRANCE_RISE = 8;
const ENTRANCE_STEP = 40;
const ENTRANCE_STEP_CAP = 6;

/**
 * Hearth card: warm surface, hairline border, warm low shadow.
 *
 * The default `rest` elevation is what almost everything wants. Step up only
 * when the card genuinely left the page: `raised` for a menu or a popover,
 * `floating` for a bottom sheet or a modal. In dark the same steps lean on
 * surface contrast instead of shadow — see the `elevation` token docs.
 *
 * `entrance` is the opt-in list arrival: pass the card's index and it fades
 * up a few pixels into place, each card a beat behind the one above it. Use
 * it when rows have genuinely just landed — a query resolving, a search
 * returning — and leave it off everywhere else, including on a list that
 * re-renders for a filter change. It reads the index once, on mount, so a
 * list that re-sorts does not replay itself. Under reduce motion the card
 * is simply there.
 *
 * ```tsx
 * {clubs.map((club, index) => (
 *   <Card key={club.id} entrance={index}>…</Card>
 * ))}
 * ```
 */
export function Card({
  padded = true,
  elevation = "rest",
  entrance,
  style,
  ...props
}: ViewProps & {
  padded?: boolean;
  elevation?: ElevationStep;
  /** Index in the list this card arrived with. Omit for no animation. */
  entrance?: number;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const reduceMotion = useReducedMotion();

  /* Frozen at mount: an entrance reports "this row just arrived", which is
     a thing that happens once. */
  const index = useRef(entrance).current;
  const enter = useRef(new Animated.Value(index === undefined ? 1 : 0)).current;

  useEffect(() => {
    if (index === undefined) return;
    if (reduceMotion) {
      // Land the final state instantly rather than skipping it.
      enter.setValue(1);
      return;
    }
    enter.setValue(0);
    const animation = Animated.timing(enter, {
      toValue: 1,
      duration: motion.base,
      delay: Math.min(Math.max(index, 0), ENTRANCE_STEP_CAP) * ENTRANCE_STEP,
      easing: motion.easing.enter,
      useNativeDriver: true,
    });
    animation.start();
    return () => {
      animation.stop();
      enter.setValue(1);
    };
  }, [index, reduceMotion, enter]);

  const base: ViewStyle = {
    backgroundColor: theme.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    padding: padded ? 16 : 0,
    ...elevationFor(scheme)[elevation],
  };

  if (index === undefined) {
    return <View style={[base, style]} {...props} />;
  }

  return (
    <Animated.View
      style={[
        base,
        {
          opacity: enter,
          transform: [
            {
              translateY: enter.interpolate({
                inputRange: [0, 1],
                outputRange: [ENTRANCE_RISE, 0],
              }),
            },
          ],
        },
        style,
      ]}
      {...props}
    />
  );
}
