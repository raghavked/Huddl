import { Redirect, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { hasSeenWelcome } from "@/lib/first-run";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/** Where a signed-in student goes when nothing special is pending. */
const HOME: Href = "/(tabs)/home";

/**
 * Entry: wait for the persisted session, then route to app or login.
 *
 * A signed-in student gets one extra beat before the tabs, to answer two
 * questions in parallel: is their profile finished, and have they seen the
 * welcome on this device? An unfinished profile goes to onboarding (which
 * hands off to the welcome itself), a finished one that hasn't been welcomed
 * goes to the welcome, and everyone else goes straight home.
 *
 * Every failure in here — a profile we couldn't read, storage we couldn't
 * check — falls through to home. A launch gate that can't answer must open,
 * never trap.
 */
export default function Index() {
  const { session, ready } = useAuth();
  const theme = useTheme();
  const userId = session?.user.id ?? null;

  const [destination, setDestination] = useState<Href | null>(null);

  useEffect(() => {
    if (!ready || !userId) {
      // Signed out (or not yet known): nothing to decide, and a stale
      // destination from a previous account must not survive the switch.
      setDestination(null);
      return;
    }
    let alive = true;
    void (async () => {
      let next: Href = HOME;
      try {
        const [profileRes, seenWelcome] = await Promise.all([
          supabase
            .from("profiles")
            .select("display_name")
            .eq("id", userId)
            .maybeSingle(),
          hasSeenWelcome(),
        ]);
        const row = profileRes.data as { display_name: string | null } | null;
        if (profileRes.error) {
          // We can't tell whether setup is finished, so we don't act on it.
          next = HOME;
        } else if (!row || !row.display_name?.trim()) {
          next = "/onboarding";
        } else if (!seenWelcome) {
          next = "/welcome";
        }
      } catch {
        next = HOME;
      }
      if (alive) setDestination(next);
    })();
    return () => {
      alive = false;
    };
  }, [ready, userId]);

  if (!ready || (userId !== null && destination === null)) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.background,
        }}
      >
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }

  return <Redirect href={destination ?? "/(auth)/login"} />;
}
