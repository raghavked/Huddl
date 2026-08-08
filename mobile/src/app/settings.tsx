import Feather from "@expo/vector-icons/Feather";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
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
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 8,
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

  async function handleSignOut() {
    setSignOutError(null);
    setSigningOut(true);
    const { error: signOutErr } = await supabase.auth.signOut();
    if (signOutErr) {
      setSigningOut(false);
      setSignOutError("Sign out didn't go through — give it another try.");
      return;
    }
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
        "We couldn't delete your account just now — nothing was removed. Give it another try in a minute."
      );
      return;
    }
    // The account is already gone server-side; signOut just clears this
    // device, so a failure here shouldn't stop the walk to the door.
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore — the session is dead either way.
    }
    router.replace("/(auth)/login");
  }

  function confirmDeleteAccount() {
    Alert.alert(
      "Delete your account?",
      "This permanently deletes your profile and everything you've shared on Huddl. It can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
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

  const version = Constants.expoConfig?.version ?? "1.0.0";

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 20,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
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
        Settings
      </AppText>

      {loading ? (
        <Card style={{ alignItems: "center", paddingVertical: 32 }}>
          <ActivityIndicator color={theme.brand} />
        </Card>
      ) : error ? (
        <Card style={{ alignItems: "center", gap: 10, paddingVertical: 24 }}>
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
        <Card style={{ alignItems: "center", gap: 6, paddingVertical: 24 }}>
          <AppText variant="bodySemi">We couldn't find your profile</AppText>
          <AppText variant="caption" muted style={{ textAlign: "center" }}>
            Try signing out and back in — that usually clears it up.
          </AppText>
        </Card>
      ) : (
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
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
          <View style={{ flex: 1, gap: 2 }}>
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
                  gap: 4,
                  marginTop: 2,
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

      <Card padded={false} style={{ marginTop: 20 }}>
        <SettingsLink
          icon="bell"
          label="Notifications"
          first
          onPress={() => router.push("/notifications")}
        />
        <SettingsLink
          icon="bell"
          label="Push notifications"
          onPress={() => router.push("/push-settings")}
        />
        <SettingsLink
          icon="user"
          label="Account"
          onPress={() => router.push("/account")}
        />
        <SettingsLink
          icon="users"
          label="People directory"
          onPress={() => router.push("/people")}
        />
        <SettingsLink
          icon="slash"
          label="Blocked people"
          onPress={() => router.push("/blocked")}
        />
        <SettingsLink
          icon="book"
          label="Community guidelines"
          onPress={() => router.push("/legal/guidelines")}
        />
      </Card>

      <View style={{ marginTop: 20, gap: 8 }}>
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
            gap: 8,
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

      {/* Danger zone — deletion is real and forever, so it sits apart. */}
      <View style={{ marginTop: 24, gap: 8 }}>
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
              gap: 12,
              paddingHorizontal: 16,
              paddingVertical: 8,
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
          gap: 2,
          paddingTop: 24,
        }}
      >
        <AppText variant="caption" muted>
          Huddl v{version}
        </AppText>
        <AppText variant="caption" muted>
          Made for campus, with love.
        </AppText>
      </View>
    </View>
  );
}
