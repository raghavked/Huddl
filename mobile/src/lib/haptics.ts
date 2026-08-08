import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * One-line haptic taps for the app's small physical moments.
 *
 * Haptics are seasoning — reserve for moments of completion or commitment,
 * not every touch. Each helper is fire-and-forget: it no-ops on web and
 * swallows any runtime failure, so call sites stay a single line.
 */

/** A light tick — a message leaving, a reaction landing, a tab press. */
export function tapLight(): void {
  if (Platform.OS === "web") return;
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => undefined
    );
  } catch {
    // A missed haptic is never worth surfacing.
  }
}

/** A success buzz — something got finished, pinned, or committed. */
export function tapSuccess(): void {
  if (Platform.OS === "web") return;
  try {
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success
    ).catch(() => undefined);
  } catch {
    // A missed haptic is never worth surfacing.
  }
}

/** A warning buzz — an attention-worthy or destructive moment. */
export function tapWarning(): void {
  if (Platform.OS === "web") return;
  try {
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Warning
    ).catch(() => undefined);
  } catch {
    // A missed haptic is never worth surfacing.
  }
}
