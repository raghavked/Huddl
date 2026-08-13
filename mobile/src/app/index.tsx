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
 * questions in parallel: have they been through first run, and have they seen
 * the welcome on this device? Someone who hasn't been through first run goes
 * to onboarding (which hands off to the welcome itself), someone who has but
 * hasn't been welcomed on this device goes to the welcome, and everyone else
 * goes straight home.
 *
 * **The signal is `profiles.accepted_terms_at`, not the name.** Signup writes
 * a display name and a handle for every account the moment it is created, so
 * a missing name never marks a new student; `accepted_terms_at` is null until
 * they come out the far side of onboarding, and it is the one column whose
 * meaning (they saw the first-run flow and agreed to the terms) is exactly
 * the question this gate is asking. Both exits from `/onboarding` stamp it,
 * including "Skip for now", so nobody is handed the same screen twice.
 *
 * Every failure in here, a profile we couldn't read or storage we couldn't
 * check, falls through to home. A launch gate that can't answer must open,
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
            .select("accepted_terms_at")
            .eq("id", userId)
            .maybeSingle(),
          hasSeenWelcome(),
        ]);
        const row = profileRes.data as {
          accepted_terms_at: string | null;
        } | null;
        if (profileRes.error) {
          // We can't tell whether setup is finished, so we don't act on it.
          next = HOME;
        } else if (!row || !row.accepted_terms_at) {
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
