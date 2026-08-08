import Feather from "@expo/vector-icons/Feather";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
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
