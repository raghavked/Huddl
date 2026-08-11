import Feather from "@expo/vector-icons/Feather";
import { Redirect, Tabs } from "expo-router";
import { fonts } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { tapLight } from "@/lib/haptics";
import { useAuth } from "@/providers/auth-provider";

const TAB_ICONS = {
  home: "home",
  channels: "hash",
  messages: "message-circle",
  clubs: "users",
  events: "calendar",
} as const;

export default function TabsLayout() {
  const theme = useTheme();
  const { session, ready } = useAuth();

  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      // A light tick on every tab press — the one "every touch" exception,
      // since switching context is itself a small commitment.
      screenListeners={{ tabPress: () => tapLight() }}
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneStyle: { backgroundColor: theme.background },
        tabBarActiveTintColor: theme.brandInk,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
        },
        tabBarLabelStyle: { fontFamily: fonts.bodySemi, fontSize: 10 },
        tabBarIcon: ({ color, size }) => (
          <Feather
            // The glyph is decoration. The tab button underneath already
            // announces the destination and whether it's the one you're on,
            // and an icon font read aloud is a private-use character.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            name={TAB_ICONS[route.name as keyof typeof TAB_ICONS] ?? "circle"}
            size={size - 2}
            color={color}
          />
        ),
      })}
    >
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="channels" options={{ title: "Channels" }} />
      <Tabs.Screen name="messages" options={{ title: "Messages" }} />
      <Tabs.Screen name="clubs" options={{ title: "Clubs" }} />
      <Tabs.Screen name="events" options={{ title: "Events" }} />
    </Tabs>
  );
}
