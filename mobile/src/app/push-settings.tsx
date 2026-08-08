import Feather from "@expo/vector-icons/Feather";
import * as Device from "expo-device";
import { PermissionStatus } from "expo-modules-core";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Linking, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { registerForPush } from "@/lib/push";
import { useAuth } from "@/providers/auth-provider";

type PermissionView = "loading" | "granted" | "denied" | "undetermined";

export default function PushSettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const isDevice = Device.isDevice;
  const [permission, setPermission] = useState<PermissionView>("loading");
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  const checkPermission = useCallback(async () => {
    if (!isDevice) return;
    const current = await Notifications.getPermissionsAsync();
    setPermission(
      current.granted
        ? "granted"
        : current.status === PermissionStatus.UNDETERMINED
          ? "undetermined"
          : "denied"
    );
  }, [isDevice]);

  // Check on mount, and again whenever the app comes back to the
  // foreground — the usual round trip after visiting system Settings.
  useEffect(() => {
    void checkPermission();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkPermission();
    });
    return () => sub.remove();
  }, [checkPermission]);

  const handleEnable = useCallback(async () => {
    if (!userId || enabling) return;
    setEnableError(null);
    setEnabling(true);
    const result = await registerForPush(userId);
    setEnabling(false);
    if (result === "unavailable") {
      setEnableError(
        "We couldn't set up push on this device just now. Give it another try in a bit."
      );
    }
    await checkPermission();
  }, [userId, enabling, checkPermission]);

  const statusIcon: keyof typeof Feather.glyphMap =
    permission === "granted" ? "bell" : "bell-off";

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          marginLeft: -10,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather name="chevron-left" size={26} color={theme.foreground} />
      </Pressable>

      <AppText variant="display" style={{ marginTop: 2, marginBottom: 16 }}>
        Push notifications
      </AppText>

      {!isDevice ? (
        <Card style={{ alignItems: "center", gap: 6, paddingVertical: 24 }}>
          <Feather name="smartphone" size={20} color={theme.muted} />
          <AppText variant="bodySemi">This needs a real phone</AppText>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 280 }}
          >
            Push notifications only work on a physical device — simulators sit
            this one out.
          </AppText>
        </Card>
      ) : permission === "loading" ? (
        <Card style={{ alignItems: "center", paddingVertical: 32 }}>
          <ActivityIndicator color={theme.brand} />
        </Card>
      ) : (
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.control,
                backgroundColor:
                  permission === "granted" ? theme.brandSoft : theme.surface2,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather
                name={statusIcon}
                size={18}
                color={permission === "granted" ? theme.brand : theme.muted}
              />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="bodySemi">
                {permission === "granted"
                  ? "On — this device gets a nudge for DMs, mentions, and class dates"
                  : permission === "denied"
                    ? "Off — enable in Settings"
                    : "Not set up yet"}
              </AppText>
              {permission === "denied" ? (
                <AppText variant="caption" muted>
                  Notifications are turned off for Huddl in your phone's
                  settings.
                </AppText>
              ) : null}
            </View>
          </View>

          {permission === "undetermined" ? (
            <Button
              label="Enable push"
              pending={enabling}
              disabled={!userId}
              onPress={() => void handleEnable()}
            />
          ) : null}
          {permission === "denied" ? (
            <Button
              label="Open Settings"
              variant="soft"
              onPress={() => void Linking.openSettings()}
            />
          ) : null}
          {enableError ? (
            <AppText variant="caption" style={{ color: theme.danger }}>
              {enableError}
            </AppText>
          ) : null}
        </Card>
      )}

      <AppText variant="caption" muted style={{ marginTop: 12, maxWidth: 320 }}>
        Pushes cover the stuff worth a buzz: new DMs, replies to your threads,
        mentions, class calendar drops, and updates to events you're going to.
      </AppText>
    </View>
  );
}
