import Feather from "@expo/vector-icons/Feather";
import * as Device from "expo-device";
import { PermissionStatus } from "expo-modules-core";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { registerForPush } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type PermissionView = "loading" | "granted" | "denied" | "undetermined";

/* Per-kind push opt-outs, mirrored from profiles.notification_prefs.
   A missing key means on; {"dm":"off"} means quiet. We only ever store
   'off' keys — re-enabling removes the key, keeping the object minimal. */
type NotificationPrefs = Record<string, string>;

type PushKind =
  | "dm"
  | "mention"
  | "thread_reply"
  | "course_calendar"
  | "event"
  | "system";

const PUSH_KINDS: {
  kind: PushKind;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  caption: string;
}[] = [
  {
    kind: "dm",
    icon: "message-circle",
    label: "Direct messages",
    caption: "New messages sent straight to you.",
  },
  {
    kind: "mention",
    icon: "at-sign",
    label: "Mentions",
    caption: "When someone tags you by name.",
  },
  {
    kind: "thread_reply",
    icon: "corner-down-right",
    label: "Thread replies",
    caption: "Replies in threads you're part of.",
  },
  {
    kind: "course_calendar",
    icon: "book-open",
    label: "Class calendar",
    caption: "New due dates and exams in your classes.",
  },
  {
    kind: "event",
    icon: "calendar",
    label: "Events",
    caption: "Updates to events you're going to.",
  },
  {
    kind: "system",
    icon: "bell",
    label: "Weekly digest + announcements",
    caption: "Your Monday look-ahead, plus the rare heads-up from Huddl.",
  },
];

/** Icon tile + label + caption + switch, one push kind per row. */
function PushKindRow({
  icon,
  label,
  caption,
  first,
  on,
  disabled,
  onToggle,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  caption: string;
  first: boolean;
  on: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.control,
          backgroundColor: disabled ? theme.surface2 : theme.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather
          name={icon}
          size={16}
          color={disabled ? theme.muted : theme.brand}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodySemi">{label}</AppText>
        <AppText variant="caption" muted>
          {caption}
        </AppText>
      </View>
      <Switch
        accessibilityLabel={label}
        value={on}
        disabled={disabled}
        onValueChange={onToggle}
        trackColor={{ false: theme.surface3, true: theme.brand }}
        thumbColor={theme.onSolid}
        ios_backgroundColor={theme.surface3}
      />
    </View>
  );
}

export default function PushSettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const isDevice = Device.isDevice;
  const [permission, setPermission] = useState<PermissionView>("loading");
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

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

  const loadPrefs = useCallback(async () => {
    if (!userId) return;
    setPrefsError(null);
    const { data, error } = await supabase
      .from("profiles")
      .select("notification_prefs")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) {
      setPrefsError("We couldn't load your push preferences right now.");
      return;
    }
    const raw = (data as { notification_prefs: unknown }).notification_prefs;
    setPrefs(
      raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as NotificationPrefs)
        : {}
    );
  }, [userId]);

  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

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

  const handleToggle = useCallback(
    async (kind: PushKind, next: boolean) => {
      if (!userId || prefs === null) return;
      setToggleError(null);
      const wasOff = prefs[kind] === "off";
      // Keep the stored object minimal: only 'off' keys, never 'on'.
      const updated: NotificationPrefs = { ...prefs };
      if (next) delete updated[kind];
      else updated[kind] = "off";
      setPrefs(updated);
      const { error } = await supabase
        .from("profiles")
        .update({ notification_prefs: updated })
        .eq("id", userId);
      if (error) {
        // Roll just this switch back — other flips since stay put.
        setPrefs((current) => {
          if (current === null) return current;
          const rolled = { ...current };
          if (wasOff) rolled[kind] = "off";
          else delete rolled[kind];
          return rolled;
        });
        setToggleError(
          "That change didn't save — your phone kept the old setting. Give it another flip."
        );
      }
    },
    [userId, prefs]
  );

  const statusIcon: keyof typeof Feather.glyphMap =
    permission === "granted" ? "bell" : "bell-off";

  const pushReady = isDevice && permission === "granted";

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

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {!isDevice ? (
          <Card style={{ alignItems: "center", gap: 6, paddingVertical: 24 }}>
            <Feather name="smartphone" size={20} color={theme.muted} />
            <AppText variant="bodySemi">This needs a real phone</AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 280 }}
            >
              Push notifications only work on a physical device — simulators
              sit this one out.
            </AppText>
          </Card>
        ) : permission === "loading" ? (
          <Card style={{ alignItems: "center", paddingVertical: 32 }}>
            <ActivityIndicator color={theme.brand} />
          </Card>
        ) : (
          <Card style={{ gap: 12 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
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

        <View style={{ marginTop: 24 }}>
          <AppText variant="label">What gets pushed</AppText>
          <AppText variant="caption" muted style={{ marginTop: 4 }}>
            The in-app inbox always keeps everything — these only quiet your
            phone.
          </AppText>

          <Card padded={false} style={{ marginTop: 10 }}>
            {prefsError ? (
              <View
                style={{ alignItems: "center", gap: 10, paddingVertical: 20 }}
              >
                <AppText
                  variant="caption"
                  muted
                  style={{ textAlign: "center", maxWidth: 260 }}
                >
                  {prefsError}
                </AppText>
                <Button
                  label="Try again"
                  variant="soft"
                  size="sm"
                  onPress={() => void loadPrefs()}
                />
              </View>
            ) : prefs === null ? (
              <View style={{ alignItems: "center", paddingVertical: 24 }}>
                <ActivityIndicator color={theme.brand} />
              </View>
            ) : (
              PUSH_KINDS.map((entry, index) => (
                <PushKindRow
                  key={entry.kind}
                  icon={entry.icon}
                  label={entry.label}
                  caption={entry.caption}
                  first={index === 0}
                  on={prefs[entry.kind] !== "off"}
                  disabled={!pushReady}
                  onToggle={(next) => void handleToggle(entry.kind, next)}
                />
              ))
            )}
          </Card>

          {!pushReady && isDevice && permission !== "loading" ? (
            <AppText variant="caption" muted style={{ marginTop: 8 }}>
              These wake up once push is on for this device — flip it on above
              first.
            </AppText>
          ) : null}
          {toggleError ? (
            <AppText
              variant="caption"
              style={{ color: theme.danger, marginTop: 8 }}
            >
              {toggleError}
            </AppText>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
