import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { PRIVACY_POLICY } from "@/lib/legal-content";

/* Privacy Policy, rendered from the shared legal content module.
   Reachable from signup (before auth) and from settings, so the back
   fallback goes to the app root rather than assuming a signed-in stack. */

export default function PrivacyScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, []);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
      }}
    >
      <View style={{ paddingHorizontal: 20 }}>
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
          <Feather name="chevron-left" size={26} color={theme.foreground} />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        <AppText variant="display" style={{ marginTop: 2 }}>
          {PRIVACY_POLICY.title}
        </AppText>
        <AppText variant="caption" muted style={{ marginTop: 4 }}>
          Last updated {PRIVACY_POLICY.updated}
        </AppText>

        {PRIVACY_POLICY.sections.map((section) => (
          <View key={section.heading} style={{ marginTop: 24, gap: 6 }}>
            <AppText variant="title">{section.heading}</AppText>
            <AppText style={{ lineHeight: 22 }}>{section.body}</AppText>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
