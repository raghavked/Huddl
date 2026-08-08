import Constants from "expo-constants";
import * as Device from "expo-device";
import { PermissionStatus } from "expo-modules-core";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";

/**
 * Device push registration. The backend side already exists: a trigger on
 * `notifications` posts every insert to Expo's push API using the rows in
 * `push_tokens` — all the client has to do is keep that table honest.
 */

export type PushRegistrationResult = "granted" | "denied" | "unavailable";

/** The Expo push token this app run registered, so sign-out can clean up. */
let registeredToken: string | null = null;

/**
 * Foreground presentation: show the banner and add to the list, keep quiet
 * otherwise — no sounds, and we never touch the app badge. Call once at
 * module scope in the root layout.
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
  });
}

/** Android needs a channel before anything can be shown; default importance. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Ask for permission (when undetermined), fetch this device's Expo push
 * token, and upsert it into `push_tokens` for the signed-in user.
 *
 * - `unavailable` — not a physical device, or the token fetch/save failed
 *   (for example Expo Go without an EAS project id). Never throws for that.
 * - `denied` — the user has said no; the OS settings app is the only way back.
 * - `granted` — the token row is saved and this device will get pushes.
 */
export async function registerForPush(
  userId: string
): Promise<PushRegistrationResult> {
  if (!Device.isDevice) return "unavailable";

  let permission = await Notifications.getPermissionsAsync();
  if (permission.status === PermissionStatus.UNDETERMINED) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) return "denied";

  let token: string;
  try {
    await ensureAndroidChannel();
    const projectIdRaw: unknown = Constants?.expoConfig?.extra?.eas?.projectId;
    const projectId =
      typeof projectIdRaw === "string" && projectIdRaw ? projectIdRaw : undefined;
    const result = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    token = result.data;
  } catch {
    // No project id (Expo Go), offline, or Expo's servers hiccuped —
    // registration just quietly doesn't happen this time.
    return "unavailable";
  }

  const platform =
    Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "unknown";
  const { error } = await supabase
    .from("push_tokens")
    .upsert(
      { user_id: userId, token, platform },
      { onConflict: "user_id,token" }
    );
  if (error) return "unavailable";

  registeredToken = token;
  return "granted";
}

/**
 * Remove this device's push token row so a signed-out phone stops buzzing.
 * Call it right before `supabase.auth.signOut()`. No-op when this app run
 * never registered a token.
 */
export async function unregisterPush(userId: string): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  const { error } = await supabase
    .from("push_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("token", token);
  if (!error) registeredToken = null;
}
