import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
} from "@expo-google-fonts/bricolage-grotesque";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { useTheme } from "@/hooks/use-theme";
import { routeForLink } from "@/lib/notification-links";
import { configureNotificationHandler, registerForPush } from "@/lib/push";
import { AuthProvider, useAuth } from "@/providers/auth-provider";
import { DisplayProvider, useDisplay } from "@/providers/display-provider";

SplashScreen.preventAutoHideAsync();

// Foreground pushes show as banners (no sound, no badge). Module scope so
// the handler exists before any notification can arrive.
configureNotificationHandler();

/**
 * Follow a tapped push to its screen, if the payload's link maps to one.
 *
 * The response is cleared once it has been handled: the OS keeps handing the
 * most recent tap back to `getLastNotificationResponseAsync`, so without this
 * every remount of the shell — signing out and back in, most reliably —
 * re-navigates to the last notification the student ever tapped.
 */
function openNotificationResponse(response: Notifications.NotificationResponse) {
  const link = response.notification.request.content.data?.link;
  const route = typeof link === "string" ? routeForLink(link) : null;
  Notifications.clearLastNotificationResponse();
  if (route) router.push(route);
}

/**
 * Invisible wiring: registers this device for push once per signed-in user,
 * and routes notification taps (both live and the cold-start tap that
 * launched the app). Lives inside AuthProvider so it can watch the session.
 */
function PushGateway() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  // Register once per user per app run; harmless no-op off real devices.
  const registeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || registeredFor.current === userId) return;
    registeredFor.current = userId;
    void registerForPush(userId);
  }, [userId]);

  useEffect(() => {
    const sub =
      Notifications.addNotificationResponseReceivedListener(
        openNotificationResponse
      );
    // A tap may have launched the app before this listener existed.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) openNotificationResponse(response);
    });
    return () => sub.remove();
  }, []);

  return null;
}

/**
 * Everything below the display preferences. Split out from `RootLayout` on
 * purpose: `useTheme()` now reads the resolved appearance out of
 * `DisplayProvider`, so no component that paints may sit above it.
 */
function RootShell() {
  const theme = useTheme();
  const { ready, resolvedScheme } = useDisplay();
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  // Hold the splash until the fonts are in *and* the stored appearance has
  // been read, so a student who picked dark never gets a flash of cream.
  const canPaint = fontsLoaded && ready;

  useEffect(() => {
    if (canPaint) {
      void SplashScreen.hideAsync();
    }
  }, [canPaint]);

  if (!canPaint) return null;

  return (
    <AuthProvider>
      {/* Follows the chosen appearance, not the device's — "auto" would
          fight an explicit light/dark pick. */}
      <StatusBar style={resolvedScheme === "dark" ? "light" : "dark"} />
      <PushGateway />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
      </Stack>
    </AuthProvider>
  );
}

export default function RootLayout() {
  return (
    <DisplayProvider>
      <RootShell />
    </DisplayProvider>
  );
}
