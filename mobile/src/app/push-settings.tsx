import Feather from "@expo/vector-icons/Feather";
import * as Device from "expo-device";
import { PermissionStatus } from "expo-modules-core";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AppState,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppText,
  Button,
  Card,
  Chip,
  SectionLabel,
  Sheet,
  Skeleton,
  type ChipTone,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { tapLight } from "@/lib/haptics";
import { registerForPush } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type PermissionView = "loading" | "granted" | "denied" | "undetermined";

/* Per-kind push opt-outs, mirrored from profiles.notification_prefs.
   A missing key means on; {"dm":"off"} means quiet. We only ever store
   'off' keys; re-enabling removes the key, keeping the object minimal. */
type NotificationPrefs = Record<string, string>;

/* profiles.quiet_hours, exactly the shape in_quiet_hours() reads. `null`
   here is the app's word for "no window". On the row that is stored as an
   empty object, never a deleted or null column. */
type QuietHours = { start: string; end: string; tz: string };

type PushKind =
  | "dm"
  | "mention"
  | "thread_reply"
  | "thanks"
  | "friend"
  | "schedule_privacy"
  | "course_calendar"
  | "event"
  | "club_post"
  | "system";

/* Every kind the push trigger can send, in the order a student thinks about
   them: people talking to you, then your week, then Hearth itself. The gate
   in push_notification() is generic (it reads
   `notification_prefs ->> kind` for whatever kind is on the row), so this
   list is not a server contract, it is a promise that anything which can
   actually buzz your phone has a switch here. A kind that fires with no row
   in this list leaves the student no way out short of quitting the thing it
   came from, which is what `club_post` and `thanks` did until they were
   added. */
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
    kind: "thanks",
    icon: "heart",
    label: "Thanks on your notes",
    caption: "When a classmate says thanks for notes you uploaded.",
  },
  {
    kind: "friend",
    icon: "user-plus",
    label: "Friend requests",
    caption: "When someone asks to be friends, and when they say yes.",
  },
  {
    kind: "schedule_privacy",
    icon: "shield",
    label: "Privacy notices",
    caption: "When something you stored is accessed, and other notes about your data.",
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
    kind: "club_post",
    // Feather has no megaphone; volume-2 is this app's, in the inbox too.
    icon: "volume-2",
    label: "Club announcements",
    caption: "When an officer posts in a club you've joined.",
  },
  {
    kind: "system",
    icon: "bell",
    label: "Weekly digest + announcements",
    caption: "Your Monday look-ahead, plus the rare heads-up from Hearth.",
  },
];

/* ---------------------------- quiet hours ---------------------------- */

const QUIET_DEFAULT_START = "22:00";
const QUIET_DEFAULT_END = "08:00";
const FALLBACK_TZ = "America/Los_Angeles";

/** Every half hour of the day, "00:00" through "23:30". */
const HALF_HOURS: string[] = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  return `${hour < 10 ? "0" : ""}${hour}:${index % 2 === 0 ? "00" : "30"}`;
});

/** Sheet.Row is 44 tall and the picker list gaps by 4. */
const PICKER_STRIDE = 48;

/** The window follows the phone it was set on; the server needs the name. */
function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : FALLBACK_TZ;
  } catch {
    return FALLBACK_TZ;
  }
}

/** "America/Los_Angeles" → "Los Angeles". */
function zoneLabel(zone: string): string {
  const tail = zone.split("/").pop();
  return (tail ?? zone).replace(/_/g, " ");
}

/** Snap anything the column might hold onto the half-hour grid. */
function normalizeTime(value: string, fallback: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return fallback;
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const half = Number(match[2]) >= 30 ? "30" : "00";
  return `${hour < 10 ? "0" : ""}${hour}:${half}`;
}

/** `null` for the empty object, a malformed row, or a missing time. */
function parseQuietHours(raw: unknown): QuietHours | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.start !== "string" || typeof value.end !== "string") {
    return null;
  }
  const zone = typeof value.tz === "string" && value.tz.length > 0
    ? value.tz
    : FALLBACK_TZ;
  return {
    start: normalizeTime(value.start, QUIET_DEFAULT_START),
    end: normalizeTime(value.end, QUIET_DEFAULT_END),
    tz: zone,
  };
}

/** "22:00" → "10:00 PM". */
function clockLabel(value: string): string {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour < 12 ? "AM" : "PM";
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:${minuteText ?? "00"} ${suffix}`;
}

/* The two lines this screen exists to say out loud. Both live as plain
   strings so the copy reads as copy and not as JSX. */

function quietSentence(quiet: QuietHours | null): string {
  if (!quiet) {
    return "Pick a window (10:00 PM until 8:00 AM, say) and your phone stays silent inside it. Nothing gets lost either: whatever arrives is waiting in your inbox in the morning.";
  }
  return `Between ${clockLabel(quiet.start)} and ${clockLabel(
    quiet.end
  )} nothing buzzes. Nothing is dropped either: whatever arrives is sitting in your inbox, and the first nudge after the window carries it along. Those times follow the ${zoneLabel(
    quiet.tz
  )} clock.`;
}

const DIGEST_NOTE =
  "When a class channel gets going, Hearth rolls the pile into one nudge (the “4 new notifications” kind) instead of buzzing twelve times. Tapping it opens your inbox with all of them in it.";

/* ------------------------------ saving ------------------------------- */

/**
 * One write to your own profiles row, and an honest answer about whether it
 * landed.
 *
 * A refused write arrives one of two ways. A column the grant does not name
 * raises a privilege error; a row the policy will not match raises nothing
 * at all, because PostgREST answers a zero-row UPDATE with a 204 and an
 * empty body.
 * Reading `error` alone catches the first and takes the second for success,
 * which on a settings screen means a switch that sits where you left it on
 * top of a phone that behaves exactly as it did before.
 *
 * `profiles` is the table where that has actually bitten. 0034 traded the
 * blanket UPDATE for an explicit column list so nobody could hand themselves
 * a moderator flag, and quiet_hours was missing from that list from the day
 * 0035 added the column until 0039 put it back: a whole shipped setting
 * whose every write was refused. So ask for the row back and believe the
 * row, not the status code: false means nothing changed, whatever the
 * reason, and the caller owes the student a sentence saying so.
 *
 * It reads back `id` rather than the column it just wrote, on purpose. The
 * value we sent is the value that is there, and adopting a re-read would let
 * a slow first write land on top of a faster second one.
 */
async function saveProfileSettings(
  userId: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  return !error && data !== null;
}

/* ------------------------------- rows -------------------------------- */

/**
 * Icon tile + label + caption + whatever sits on the right, one per row.
 *
 * The drawn half of the row (tile, label, caption) is hidden from the
 * screen reader on purpose, so a setting is one item instead of three
 * fragments and a switch. That makes the label a requirement rather than a
 * nicety: a pressable row says everything in its `accessibilityLabel`, and a
 * row whose `trailing` is a `Switch` says everything in the switch's own
 * label, where the on/off state is announced with it.
 */
function SettingRow({
  icon,
  label,
  caption,
  first,
  disabled = false,
  trailing,
  onPress,
  accessibilityLabel,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  caption?: string;
  first: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
  /** Pass it and the whole row becomes the target; leave it off for a switch. */
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const frame: ViewStyle = {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space.close,
    paddingHorizontal: space.card,
    paddingVertical: space.room,
    borderTopWidth: first ? 0 : 1,
    borderTopColor: theme.border,
  };

  const content = (
    <>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
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
        <View style={{ flex: 1, gap: space.hair }}>
          <AppText variant="bodySemi">{label}</AppText>
          {caption ? (
            <AppText variant="caption" muted>
              {caption}
            </AppText>
          ) : null}
        </View>
      </View>
      {trailing}
    </>
  );

  if (!onPress) {
    return <View style={[frame, { opacity: disabled ? 0.5 : 1 }]}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        frame,
        { opacity: disabled ? 0.5 : pressed ? 0.6 : 1 },
      ]}
    >
      {content}
    </Pressable>
  );
}

/** The ghost of a SettingRow, for the beat before the profile lands. */
function SettingRowSkeleton({ first }: { first: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: space.close,
        paddingHorizontal: space.card,
        paddingVertical: space.room,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.border,
      }}
    >
      <Skeleton width={32} height={32} radius={radius.control} />
      <View style={{ flex: 1, gap: space.snug }}>
        <Skeleton width="52%" height={13} radius={radius.full} />
        <Skeleton width="74%" height={10} radius={radius.full} />
      </View>
      <Skeleton width={44} height={26} radius={radius.full} />
    </View>
  );
}

/** The current time on a From / Until row, plus the chevron that says "pick". */
function TimeValue({ value }: { value: string }) {
  const theme = useTheme();
  return (
    <View
      // The row it sits on already says the time it's showing.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: "row", alignItems: "center", gap: space.tight }}
    >
      <Chip label={clockLabel(value)} tone="brand" size="md" />
      <Feather name="chevron-right" size={16} color={theme.muted} />
    </View>
  );
}

/* ------------------------------ screen ------------------------------- */

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

  // null means no window. `prefs === null` is the one loading flag for both,
  // since they arrive in the same profiles row.
  const [quiet, setQuiet] = useState<QuietHours | null>(null);
  const [quietError, setQuietError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"start" | "end" | null>(null);
  // Which end the sheet was opened on, held past the close so its title and
  // its checkmark don't change under the slide-out animation.
  const openedOn = useRef<"start" | "end">("start");
  const held = picker ?? openedOn.current;

  const deviceTz = useMemo(() => deviceTimeZone(), []);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, []);

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
  // foreground, the usual round trip after visiting system Settings.
  useEffect(() => {
    void checkPermission();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkPermission();
    });
    return () => sub.remove();
  }, [checkPermission]);

  const loadSettings = useCallback(async () => {
    if (!userId) return;
    setPrefsError(null);
    const { data, error } = await supabase
      .from("profiles")
      .select("notification_prefs, quiet_hours")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) {
      setPrefsError(
        "Your notification settings didn't come through. Check your connection and give it another go."
      );
      return;
    }
    const row = data as { notification_prefs: unknown; quiet_hours: unknown };
    setPrefs(
      row.notification_prefs !== null &&
        typeof row.notification_prefs === "object" &&
        !Array.isArray(row.notification_prefs)
        ? (row.notification_prefs as NotificationPrefs)
        : {}
    );
    setQuiet(parseQuietHours(row.quiet_hours));
  }, [userId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

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
      const saved = await saveProfileSettings(userId, {
        notification_prefs: updated,
      });
      if (!saved) {
        // Roll just this switch back. Other flips since stay put.
        setPrefs((current) => {
          if (current === null) return current;
          const rolled = { ...current };
          if (wasOff) rolled[kind] = "off";
          else delete rolled[kind];
          return rolled;
        });
        setToggleError(
          "That change didn't save, so your phone kept the old setting. Give it another flip."
        );
      }
    },
    [userId, prefs]
  );

  /**
   * Optimistic, like every other write here: the row moves, then syncs.
   *
   * A refused write puts the old window straight back and says so. Silence
   * would be the worst outcome on this particular setting: a student who
   * thinks they set quiet hours stops expecting the 2am buzz, and finds out
   * they were wrong at 2am.
   */
  const saveQuiet = useCallback(
    async (next: QuietHours | null) => {
      if (!userId) return;
      const previous = quiet;
      setQuietError(null);
      setQuiet(next);
      const saved = await saveProfileSettings(userId, {
        // Off is an empty object, not a null and not a missing row. That is
        // what in_quiet_hours() reads as "never quiet".
        quiet_hours: next ?? {},
      });
      if (!saved) {
        setQuiet(previous);
        setQuietError(
          "That didn't save, so your quiet hours are still the old ones. Give it another go."
        );
      }
    },
    [userId, quiet]
  );

  const toggleQuiet = useCallback(
    (next: boolean) => {
      void saveQuiet(
        next
          ? {
              start: QUIET_DEFAULT_START,
              end: QUIET_DEFAULT_END,
              tz: deviceTimeZone(),
            }
          : null
      );
    },
    [saveQuiet]
  );

  const pickTime = useCallback(
    (value: string) => {
      const which = picker;
      setPicker(null);
      if (which === null || quiet === null) return;
      tapLight();
      void saveQuiet({
        start: which === "start" ? value : quiet.start,
        end: which === "end" ? value : quiet.end,
        // Re-stamp the zone on every edit: set the window here, it runs here.
        tz: deviceTimeZone(),
      });
    },
    [picker, quiet, saveQuiet]
  );

  const openPicker = useCallback((which: "start" | "end") => {
    openedOn.current = which;
    setPicker(which);
  }, []);

  /* --- the half-hour picker, opened to whatever is currently chosen --- */

  const listRef = useRef<ScrollView>(null);
  const pickerValue =
    quiet === null ? undefined : held === "start" ? quiet.start : quiet.end;

  const alignPicker = useCallback(() => {
    if (pickerValue === undefined) return;
    const index = HALF_HOURS.indexOf(pickerValue);
    if (index < 0) return;
    // Two rows of air above it, so the neighbouring times are visible and
    // the chosen one doesn't read as the top of the list.
    listRef.current?.scrollTo({
      y: Math.max(0, (index - 2) * PICKER_STRIDE),
      animated: false,
    });
  }, [pickerValue]);

  // Belt and braces: the modal may lay its content out before or after this
  // effect, so the layout callbacks aim it too. Landing twice is invisible.
  useEffect(() => {
    if (picker !== null) alignPicker();
  }, [picker, alignPicker]);

  const statusIcon: keyof typeof Feather.glyphMap =
    permission === "granted" ? "bell" : "bell-off";

  const statusChip: { label: string; tone: ChipTone } =
    permission === "granted"
      ? { label: "On", tone: "accent" }
      : permission === "denied"
        ? { label: "Off", tone: "danger" }
        : { label: "Not set up", tone: "neutral" };

  const statusLine =
    permission === "granted"
      ? "DMs, mentions, and class dates reach you here."
      : permission === "denied"
        ? "Notifications are turned off for Hearth in your phone's settings."
        : "Turn it on and this phone starts getting nudges.";

  const pushReady = isDevice && permission === "granted";

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
        paddingHorizontal: space.gutter,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={goBack}
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
        <Feather
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          name="chevron-left"
          size={26}
          color={theme.foreground}
        />
      </Pressable>

      <AppText
        variant="display"
        accessibilityRole="header"
        style={{ marginTop: space.hair, marginBottom: space.card }}
      >
        Push notifications
      </AppText>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.rest }}
        showsVerticalScrollIndicator={false}
      >
        {!isDevice ? (
          <Card style={{ alignItems: "center", gap: space.snug, paddingVertical: space.chapter }}>
            <Feather
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              name="smartphone"
              size={20}
              color={theme.muted}
            />
            <AppText variant="bodySemi" accessibilityRole="header">
              This needs a real phone
            </AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 280 }}
            >
              Push notifications only work on a physical device. Simulators
              sit this one out.
            </AppText>
          </Card>
        ) : permission === "loading" ? (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: space.close }}>
            <Skeleton width={40} height={40} radius={radius.control} />
            <View style={{ flex: 1, gap: space.cosy }}>
              <Skeleton width="46%" height={14} radius={radius.full} />
              <Skeleton width="72%" height={11} radius={radius.full} />
            </View>
          </Card>
        ) : (
          <Card style={{ gap: space.close }}>
            {/* Tile, heading, status pill and the line under it are one
                statement about this phone, so they are read as one. */}
            <View
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={`Push on this phone: ${statusChip.label.toLowerCase()}. ${statusLine}`}
              style={{ flexDirection: "row", alignItems: "center", gap: space.close }}
            >
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
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
              <View style={{ flex: 1, gap: space.tight }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.cosy,
                  }}
                >
                  <AppText variant="bodySemi" style={{ flexShrink: 1 }}>
                    Push on this phone
                  </AppText>
                  <Chip label={statusChip.label} tone={statusChip.tone} />
                </View>
                <AppText variant="caption" muted>
                  {statusLine}
                </AppText>
              </View>
            </View>

            {permission === "undetermined" ? (
              <Button
                label="Enable push"
                pending={enabling}
                disabled={!userId}
                accessibilityLabel="Enable push on this phone"
                accessibilityState={{ busy: enabling, disabled: !userId }}
                onPress={() => void handleEnable()}
              />
            ) : null}
            {permission === "denied" ? (
              <Button
                label="Open Settings"
                variant="soft"
                accessibilityLabel="Open your phone's settings for Hearth"
                onPress={() => void Linking.openSettings()}
              />
            ) : null}
            {enableError ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger }}
              >
                {enableError}
              </AppText>
            ) : null}
          </Card>
        )}

        {prefsError ? (
          <Card
            style={{
              alignItems: "center",
              gap: space.cosy,
              marginTop: space.chapter,
              paddingVertical: space.chapter,
            }}
          >
            <Feather
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              name="cloud-off"
              size={20}
              color={theme.muted}
            />
            <AppText variant="bodySemi" accessibilityRole="header">
              We couldn't reach your settings
            </AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 280 }}
            >
              {prefsError}
            </AppText>
            <Button
              label="Try again"
              variant="soft"
              size="sm"
              onPress={() => void loadSettings()}
            />
          </Card>
        ) : (
          <>
            <SectionLabel text="Quiet hours" />

            <Card padded={false}>
              {prefs === null ? (
                <SettingRowSkeleton first />
              ) : (
                <>
                  <SettingRow
                    icon="moon"
                    label="Quiet hours"
                    caption={
                      quiet
                        ? "Silent between the times below."
                        : "Your phone can buzz at any hour."
                    }
                    first
                    trailing={
                      <Switch
                        accessibilityRole="switch"
                        accessibilityLabel={`Quiet hours. ${
                          quiet
                            ? "Silent between the times below."
                            : "Your phone can buzz at any hour."
                        }`}
                        accessibilityState={{ checked: quiet !== null }}
                        value={quiet !== null}
                        onValueChange={toggleQuiet}
                        trackColor={{
                          false: theme.surface3,
                          true: theme.brand,
                        }}
                        thumbColor={theme.onSolid}
                        ios_backgroundColor={theme.surface3}
                      />
                    }
                  />
                  {quiet ? (
                    <>
                      <SettingRow
                        icon="sunset"
                        label="From"
                        first={false}
                        onPress={() => openPicker("start")}
                        accessibilityLabel={`Change when quiet hours start. Currently ${clockLabel(
                          quiet.start
                        )}`}
                        trailing={<TimeValue value={quiet.start} />}
                      />
                      <SettingRow
                        icon="sunrise"
                        label="Until"
                        first={false}
                        onPress={() => openPicker("end")}
                        accessibilityLabel={`Change when quiet hours end. Currently ${clockLabel(
                          quiet.end
                        )}`}
                        trailing={<TimeValue value={quiet.end} />}
                      />
                    </>
                  ) : null}
                </>
              )}
            </Card>

            {prefs === null ? null : (
              <AppText
                variant="caption"
                muted
                accessibilityLiveRegion="polite"
                style={{ marginTop: space.room }}
              >
                {quietSentence(quiet)}
              </AppText>
            )}
            {quiet && quiet.start === quiet.end ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.warning, marginTop: space.snug }}
              >
                From and until are the same time, so the window is empty and
                nothing is quiet yet. Move one of them.
              </AppText>
            ) : null}
            {quiet && quiet.tz !== deviceTz ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.warning, marginTop: space.snug }}
              >
                {`This phone is on ${zoneLabel(
                  deviceTz
                )} time. Pick either time again to move the window here.`}
              </AppText>
            ) : null}
            {!pushReady && isDevice && permission !== "loading" ? (
              <AppText variant="caption" muted style={{ marginTop: space.snug }}>
                Worth setting either way: quiet hours ride with your account,
                not just this phone.
              </AppText>
            ) : null}
            {quietError ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, marginTop: space.snug }}
              >
                {quietError}
              </AppText>
            ) : null}

            <SectionLabel text="What gets pushed" />

            <Card padded={false}>
              {prefs === null
                ? PUSH_KINDS.map((entry, index) => (
                    <SettingRowSkeleton key={entry.kind} first={index === 0} />
                  ))
                : PUSH_KINDS.map((entry, index) => (
                    <SettingRow
                      key={entry.kind}
                      icon={entry.icon}
                      label={entry.label}
                      caption={entry.caption}
                      first={index === 0}
                      disabled={!pushReady}
                      trailing={
                        <Switch
                          accessibilityRole="switch"
                          /* The dimmed row is the only thing on screen
                             saying these are asleep until push is on, so
                             the switch says it in words as well. */
                          accessibilityLabel={`${entry.label}. ${entry.caption}${
                            pushReady
                              ? ""
                              : " Turn push on for this phone first."
                          }`}
                          accessibilityState={{
                            checked: prefs[entry.kind] !== "off",
                            disabled: !pushReady,
                          }}
                          value={prefs[entry.kind] !== "off"}
                          disabled={!pushReady}
                          onValueChange={(next) =>
                            void handleToggle(entry.kind, next)
                          }
                          trackColor={{
                            false: theme.surface3,
                            true: theme.brand,
                          }}
                          thumbColor={theme.onSolid}
                          ios_backgroundColor={theme.surface3}
                        />
                      }
                    />
                  ))}
            </Card>

            <AppText variant="caption" muted style={{ marginTop: space.room }}>
              The in-app inbox always keeps everything. These only quiet your
              phone.
            </AppText>
            <AppText variant="caption" muted style={{ marginTop: space.snug }}>
              {DIGEST_NOTE}
            </AppText>
            {!pushReady && isDevice && permission !== "loading" ? (
              <AppText variant="caption" muted style={{ marginTop: space.snug }}>
                These wake up once push is on for this device. Flip it on
                above first.
              </AppText>
            ) : null}
            {toggleError ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, marginTop: space.snug }}
              >
                {toggleError}
              </AppText>
            ) : null}
          </>
        )}
      </ScrollView>

      <Sheet
        visible={picker !== null}
        onClose={() => setPicker(null)}
        title={held === "end" ? "Quiet until" : "Quiet from"}
      >
        <AppText variant="caption" muted style={{ marginBottom: space.snug }}>
          {held === "end"
            ? "When your phone is allowed to buzz again."
            : "When your phone goes quiet."}
        </AppText>
        <ScrollView
          ref={listRef}
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ gap: space.tight }}
          showsVerticalScrollIndicator={false}
          onLayout={alignPicker}
          onContentSizeChange={alignPicker}
        >
          {HALF_HOURS.map((value) => {
            const chosen = value === pickerValue;
            return (
              // The chosen half hour sits in a shallow well, and Sheet.Row's
              // own `selected` draws the trailing check and announces the row
              // as selected, which is the half that matters in a list of
              // forty-eight near-identical times.
              <View
                key={value}
                style={{
                  backgroundColor: chosen ? theme.surface2 : undefined,
                  borderRadius: radius.control,
                  paddingHorizontal: space.snug,
                  marginHorizontal: -6,
                }}
              >
                <Sheet.Row
                  icon="clock"
                  label={clockLabel(value)}
                  selected={chosen}
                  onPress={() => pickTime(value)}
                />
              </View>
            );
          })}
        </ScrollView>
      </Sheet>
    </View>
  );
}
