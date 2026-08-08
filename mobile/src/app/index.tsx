import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/providers/auth-provider";

/** Entry: wait for the persisted session, then route to app or login. */
export default function Index() {
  const { session, ready } = useAuth();
  const theme = useTheme();

  if (!ready) {
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

  return <Redirect href={session ? "/(tabs)/home" : "/(auth)/login"} />;
}
