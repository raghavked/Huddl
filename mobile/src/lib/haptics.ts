import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * One-line haptic taps for the app's small physical moments.
 *
 * Haptics are seasoning — reserve for moments of completion or commitment,
 * not every touch. Each helper is fire-and-forget: it no-ops on web and
 * swallows any runtime failure, so call sites stay a single line.
 *
 * They are also switchable. A student who wants a silent phone turns the
 * tick off in Look and feel, and every call site here goes quiet without a
 * single one of them changing — which is the point: `tapLight()` is called
 * from buttons, list rows, gesture handlers and a couple of plain async
 * functions, and threading a preference through all of that would be a
 * refactor in exchange for nothing.
 *
 * So the preference is *pushed down* rather than read up. These are plain
 * module functions and a module function cannot call a hook, so the one
 * place that legitimately owns the value — `DisplayProvider`, which already
 * persists appearance and type size to AsyncStorage — writes it through here
 * with `setHapticsEnabled` as it loads and on every change. The flag below
 * is a mirror of that state, never a second source of it: nothing in this
 * file reads or writes storage, and nothing else should call the setter.
 *
 * The default is on, because that is how the app behaved before there was a
 * switch and because the mirror is only ever stale for the instant between
 * launch and the provider's first read — an instant the root layout spends
 * behind the splash screen, with nothing on screen to tap.
 */

let enabled = true;

/**
 * Mirror the stored haptics preference into this module.
 *
 * Called by `DisplayProvider` only. It is synchronous on purpose: a screen
 * that flips the switch and then ticks to demonstrate it needs the new value
 * to be in place by the next line, not by the next commit.
 */
export function setHapticsEnabled(next: boolean): void {
  enabled = next;
}

/** Whether a tap would actually be felt right now. */
export function hapticsEnabled(): boolean {
  return enabled;
}

/** Web has no haptic engine, and a student may have turned the rest off. */
function silent(): boolean {
  return !enabled || Platform.OS === "web";
}

/** A light tick — a message leaving, a reaction landing, a tab press. */
export function tapLight(): void {
  if (silent()) return;
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
  if (silent()) return;
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
  if (silent()) return;
  try {
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Warning
    ).catch(() => undefined);
  } catch {
    // A missed haptic is never worth surfacing.
  }
}
