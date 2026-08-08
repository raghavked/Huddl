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

SplashScreen.preventAutoHideAsync();

// Foreground pushes show as banners (no sound, no badge). Module scope so
// the handler exists before any notification can arrive.
configureNotificationHandler();

/** Follow a tapped push to its screen, if the payload's link maps to one. */
function openNotificationResponse(response: Notifications.NotificationResponse) {
  const link = response.notification.request.content.data?.link;
  if (typeof link !== "string") return;
  const route = routeForLink(link);
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

export default function RootLayout() {
  const theme = useTheme();
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <StatusBar style="auto" />
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
