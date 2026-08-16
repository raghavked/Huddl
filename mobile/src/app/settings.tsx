import Feather from "@expo/vector-icons/Feather";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, SectionLabel } from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { clearAllDrafts, clearQueue } from "@/lib/drafts";
import { resetFirstRun } from "@/lib/first-run";
import { amIModerator } from "@/lib/moderation";
import { unregisterPush } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type ProfileRow = {
  display_name: string;
  handle: string;
  university: { name: string } | null;
};

/** "Ada Lovelace" -> "AL" for the avatar circle. */
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Icon + label + chevron navigation row, sized for a comfortable thumb. */
function SettingsLink({
  icon,
  label,
  first = false,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  first?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: space.close,
        paddingHorizontal: space.card,
        paddingVertical: space.cosy,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.control,
          backgroundColor: theme.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={16} color={theme.brand} />
      </View>
      <AppText variant="bodySemi" style={{ flex: 1 }}>
        {label}
      </AppText>
      <Feather name="chevron-right" size={18} color={theme.muted} />
    </Pressable>
  );
}

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  /* Whether this account carries the moderator badge. `null` means we don't
     know yet, and an unknown draws nothing. A row that appears for a beat
     and then vanishes is worse than one that arrives a beat late. */
  const [isModerator, setIsModerator] = useState<boolean | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, []);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from("profiles")
      .select("display_name, handle, university:universities(name)")
      .eq("id", userId)
      .maybeSingle();
    setLoading(false);
    if (queryError) {
      setError("We couldn't load your profile right now.");
      return;
    }
    setProfile((data as unknown as ProfileRow | null) ?? null);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The moderator check rides on its own, deliberately: it's a read of one
     column on our own profile, it can't be written from the app, and nobody
     needs to hear about it when it doesn't work. A failure is simply "no",
     so the rest of settings never waits on it or breaks with it. */
  useEffect(() => {
    if (!userId) {
      setIsModerator(false);
      return;
    }
    let live = true;
    amIModerator()
      .then((yes) => {
        if (live) setIsModerator(yes);
      })
      .catch(() => {
        if (live) setIsModerator(false);
      });
    return () => {
      live = false;
    };
  }, [userId]);

  /* Signing out is a handover, not just a token being dropped: this phone
     may well be the next person's phone. Three things leave with the
     student: the push row, the drafts, and the offline queue. The order
     matters. The token row goes first, while the session RLS checks
     against is still alive; the device-local halves go after the sign-out
     actually lands, so a sign-out that fails doesn't also eat the
     half-written message the student is still sitting in front of. */

  async function handleSignOut() {
    setSignOutError(null);
    setSigningOut(true);
    /* `userId` is the id we came into this tap with, which is the one the
       token row is filed under; a no-op when this run never registered. */
    if (userId) await unregisterPush(userId);
    const { error: signOutErr } = await supabase.auth.signOut();
    if (signOutErr) {
      setSigningOut(false);
      setSignOutError("Sign out didn't go through. Give it another try.");
      return;
    }
    /* Drafts and queued sends are keyed by conversation, never by account,
       so whoever signs in next would otherwise open #general and find the
       last student's unsent sentence waiting in their composer. */
    await clearAllDrafts();
    await clearQueue();
    router.replace("/(auth)/login");
  }

  /* Account deletion: two honest confirmations, then the RPC wipes the
     account (rows and files) server-side and we walk out to the login. */

  async function handleDeleteAccount() {
    setDeleting(true);
    const { error: rpcError } = await supabase.rpc("delete_own_account");
    if (rpcError) {
      setDeleting(false);
      Alert.alert(
        "That didn't go through",
        "We couldn't delete your account just now, and nothing was removed. Give it another try in a minute."
      );
      return;
    }
    // The account is already gone server-side; signOut just clears this
    // device, so a failure here shouldn't stop the walk to the door.
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore it. The session is dead either way.
    }
    /* The RPC can only reach rows; drafts and the offline queue sit in this
       phone's storage under a conversation key, so nothing server-side ever
       touches them. A deleted account should leave nothing behind here. */
    await clearAllDrafts();
    await clearQueue();
    router.replace("/(auth)/login");
  }

  function confirmDeleteAccount() {
    Alert.alert(
      "Delete your account?",
      "This permanently deletes your profile and everything you've shared on Hearth. It can't be undone.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () =>
            Alert.alert(
              "Last check",
              "This wipes your messages, courses, and files everywhere. There's no undo.",
              [
                { text: "Keep my account", style: "cancel" },
                {
                  text: "Delete everything",
                  style: "destructive",
                  onPress: () => void handleDeleteAccount(),
                },
              ]
            ),
        },
      ]
    );
  }

  /* The tour is a one-time thing by default, so the way back to it lives
     down by the version line: findable when you want it, invisible when you
     don't. Clearing the flag is what makes the welcome willing to show. */
  const replayWelcome = useCallback(async () => {
    await resetFirstRun();
    router.push("/welcome");
  }, []);

  const version = Constants.expoConfig?.version ?? "1.0.0";

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
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          /* Pulls the 44px target's optical edge back onto the gutter. */
          marginLeft: -10,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather name="chevron-left" size={26} color={theme.foreground} />
      </Pressable>

      {/* `chapter` under the title, the same as `Screen`. A screen title
          starts a new thought, and the old 16 read as a caption stuck to the
          profile card. */}
      <AppText
        variant="display"
        style={{ marginTop: space.hair, marginBottom: space.chapter }}
      >
        Settings
      </AppText>

      {/* The list outgrew the screen. `flexGrow: 1` keeps the version line
          pinned to the bottom on a tall phone and lets it scroll on a short
          one, and the footer's `marginTop: "auto"` still does the pinning. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: insets.bottom + space.rest,
        }}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <Card style={{ alignItems: "center", paddingVertical: space.rest }}>
            <ActivityIndicator color={theme.brand} />
          </Card>
        ) : error ? (
          <Card
            style={{
              alignItems: "center",
              gap: space.room,
              paddingVertical: space.chapter,
            }}
          >
            <Feather
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              name="cloud-off"
              size={26}
              color={theme.muted}
            />
            <AppText variant="bodySemi">Something went sideways</AppText>
            <AppText variant="caption" muted style={{ textAlign: "center" }}>
              {error}
            </AppText>
            <Button
              label="Try again"
              variant="soft"
              size="sm"
              onPress={() => void load()}
            />
          </Card>
        ) : !profile ? (
          <Card
            style={{
              alignItems: "center",
              gap: space.snug,
              paddingVertical: space.chapter,
            }}
          >
            <AppText variant="bodySemi">We couldn't find your profile</AppText>
            <AppText variant="caption" muted style={{ textAlign: "center" }}>
              Try signing out and back in. That usually clears it up.
            </AppText>
          </Card>
        ) : (
          <Card
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.card,
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: radius.full,
                backgroundColor: theme.brandSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <AppText
                variant="title"
                style={{ color: theme.brandInk, fontSize: 20 }}
              >
                {initialsOf(profile.display_name) || "?"}
              </AppText>
            </View>
            <View style={{ flex: 1, gap: space.hair }}>
              <AppText variant="title" numberOfLines={1}>
                {profile.display_name}
              </AppText>
              <AppText variant="caption" muted numberOfLines={1}>
                @{profile.handle}
              </AppText>
              {profile.university ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.tight,
                    marginTop: space.hair,
                  }}
                >
                  <Feather name="map-pin" size={11} color={theme.muted} />
                  <AppText variant="caption" muted numberOfLines={1}>
                    {profile.university.name}
                  </AppText>
                </View>
              ) : null}
            </View>
          </Card>
        )}

        {/* Fifteen destinations used to sit in one card as fifteen rows of
            identical height, which is a wall rather than a list: nothing to
            aim at, and finding "Blocked people" meant reading every label.
            Grouped under section labels, the scroll has handholds and each
            group is short enough to take in at once. */}
        <SectionLabel text="Your account" />
        <Card padded={false}>
          <SettingsLink
            icon="user"
            label="Account"
            first
            onPress={() => router.push("/account")}
          />
          {/* Sits right under Account because it is the other half of it:
              who you are, then what keeps it yours. `key` rather than
              `lock`, because lock is already Privacy two groups down, and one
              glyph doing two jobs makes them read as the same row. */}
          <SettingsLink
            icon="key"
            label="Security"
            onPress={() => router.push("/security")}
          />
          {/* Appearance sits high, because it changes every other screen. */}
          <SettingsLink
            icon="sliders"
            label="Look and feel"
            onPress={() => router.push("/display-settings")}
          />
          <SettingsLink
            icon="bell"
            label="Notifications"
            onPress={() => router.push("/notifications")}
          />
          {/* A different bell from the row above it: that one is the inbox,
              this one is what the phone is allowed to do. Same glyph twice
              running read as one row duplicated. */}
          <SettingsLink
            icon="smartphone"
            label="Push notifications"
            onPress={() => router.push("/push-settings")}
          />
        </Card>

        <SectionLabel text="Around campus" />
        <Card padded={false}>
          <SettingsLink
            icon="users"
            label="People directory"
            first
            onPress={() => router.push("/people")}
          />
          {/* Right under the directory, because that's where friends come
              from: find your people there, keep them here. */}
          <SettingsLink
            icon="user-check"
            label="Friends"
            onPress={() => router.push("/friends")}
          />
          <SettingsLink
            icon="bookmark"
            label="Saved messages"
            onPress={() => router.push("/saved")}
          />
          <SettingsLink
            icon="clock"
            label="Focus"
            onPress={() => router.push("/focus")}
          />
        </Card>

        <SectionLabel text="Privacy and safety" />
        <Card padded={false}>
          <SettingsLink
            icon="lock"
            label="Privacy"
            first
            onPress={() => router.push("/privacy-settings")}
          />
          <SettingsLink
            icon="slash"
            label="Blocked people"
            onPress={() => router.push("/blocked")}
          />
          <SettingsLink
            icon="download"
            label="Your data"
            onPress={() => router.push("/data-export")}
          />
          {/* A report used to disappear the moment it was sent. */}
          <SettingsLink
            icon="flag"
            label="Reports you've filed"
            onPress={() => router.push("/my-reports")}
          />
        </Card>

        <SectionLabel text="About" />
        <Card padded={false}>
          {/* First in the group on purpose. Someone opening "About" is more
              often lost than curious about the terms, and the tour they saw on
              day one is long gone by the time they need it. */}
          <SettingsLink
            icon="help-circle"
            label="How Hearth works"
            first
            onPress={() => router.push("/help")}
          />
          <SettingsLink
            icon="book"
            label="Community guidelines"
            onPress={() => router.push("/legal/guidelines")}
          />
          {/* Onboarding records that these were accepted, so they have to
              stay readable afterwards, not only on the signup screen. */}
          <SettingsLink
            icon="file-text"
            label="Terms of service"
            onPress={() => router.push("/legal/terms")}
          />
          <SettingsLink
            icon="shield"
            label="Privacy policy"
            onPress={() => router.push("/legal/privacy")}
          />
        </Card>

        {/* Only campus moderators have a queue to open, and it is a different
            job from anything above, so it gets its own group rather than a
            fifteenth row nobody else can see. */}
        {isModerator === true ? (
          <>
            <SectionLabel text="Moderation" />
            <Card padded={false}>
              <SettingsLink
                icon="inbox"
                label="Moderation queue"
                first
                onPress={() => router.push("/moderation")}
              />
            </Card>
          </>
        ) : null}

        <View style={{ marginTop: space.chapter, gap: space.cosy }}>
          {/* The shared Button pins its label color per variant, so this is the
              secondary variant's exact shell with the danger-colored label the
              design calls for. */}
          <Pressable
            accessibilityRole="button"
            disabled={signingOut}
            onPress={handleSignOut}
            style={({ pressed }) => ({
              height: 46,
              borderRadius: radius.full,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.cosy,
              opacity: signingOut ? 0.6 : pressed ? 0.85 : 1,
            })}
          >
            {signingOut ? (
              <ActivityIndicator size="small" color={theme.danger} />
            ) : (
              <Feather name="log-out" size={16} color={theme.danger} />
            )}
            <AppText variant="bodySemi" style={{ color: theme.danger }}>
              Sign out
            </AppText>
          </Pressable>
          {signOutError ? (
            <AppText
              variant="caption"
              style={{ color: theme.danger, textAlign: "center" }}
            >
              {signOutError}
            </AppText>
          ) : null}
        </View>

        {/* Danger zone: deletion is real and forever, so it sits apart. */}
        <View style={{ marginTop: space.chapter, gap: space.cosy }}>
          <AppText variant="label" style={{ color: theme.danger }}>
            Danger zone
          </AppText>
          <Card padded={false}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete account"
              disabled={deleting}
              onPress={confirmDeleteAccount}
              style={({ pressed }) => ({
                minHeight: 52,
                flexDirection: "row",
                alignItems: "center",
                gap: space.close,
                paddingHorizontal: space.card,
                paddingVertical: space.cosy,
                opacity: deleting ? 0.6 : pressed ? 0.7 : 1,
              })}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: radius.control,
                  backgroundColor: theme.danger + "1f",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color={theme.danger} />
                ) : (
                  <Feather name="trash-2" size={16} color={theme.danger} />
                )}
              </View>
              <AppText
                variant="bodySemi"
                style={{ flex: 1, color: theme.danger }}
              >
                Delete account
              </AppText>
              <Feather name="chevron-right" size={18} color={theme.danger} />
            </Pressable>
          </Card>
          <AppText variant="caption" muted>
            Permanently removes your profile, messages, and files. There's no
            undo.
          </AppText>
        </View>

        <View
          style={{
            marginTop: "auto",
            alignItems: "center",
            gap: space.hair,
            paddingTop: space.rest,
          }}
        >
          <Button
            label="Show the welcome again"
            variant="ghost"
            style={{ marginBottom: space.hair }}
            onPress={() => void replayWelcome()}
          />
          <AppText variant="caption" muted>
            Hearth v{version}
          </AppText>
          <AppText variant="caption" muted>
            Made for campus, with love.
          </AppText>
        </View>
      </ScrollView>
    </View>
  );
}
