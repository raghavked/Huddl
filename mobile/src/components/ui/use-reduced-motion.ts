import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether the OS "reduce motion" setting is on, live.
 *
 * Every animated primitive in the hearth system asks this first. The house
 * rule is not "animate less" but "land in the same place instantly" — pass
 * `motion.instant` as the duration rather than skipping the animation, so
 * state still ends up where it should.
 *
 * Starts `false` and corrects itself on the first tick, which is the right
 * default: a one-frame animation on launch is cheaper than a screen that
 * renders motionless for everyone while the query resolves.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduced(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
