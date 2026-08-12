import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Card } from "@/components/ui";
import { space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { COMMUNITY_GUIDELINES } from "@/lib/legal-content";

/* Community Guidelines, rendered from the shared legal content module.
   The document's final section is "Report it" — here it gets a card of its
   own, so the screen ends on the two things a reader can actually do:
   long-press → Report, and Settings → Blocked people. */

export default function GuidelinesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, []);

  const sections = COMMUNITY_GUIDELINES.sections;
  const reportSection = sections[sections.length - 1];
  const ruleSections = sections.slice(0, -1);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
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
          {COMMUNITY_GUIDELINES.title}
        </AppText>
        <AppText variant="caption" muted style={{ marginTop: 4 }}>
          Last updated {COMMUNITY_GUIDELINES.updated}
        </AppText>

        {ruleSections.map((section) => (
          <View key={section.heading} style={{ marginTop: 24, gap: 6 }}>
            <AppText variant="title">{section.heading}</AppText>
            <AppText style={{ lineHeight: 22 }}>{section.body}</AppText>
          </View>
        ))}

        {reportSection ? (
          <Card style={{ marginTop: 28, gap: 8 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Feather name="flag" size={16} color={theme.brand} />
              <AppText variant="title">{reportSection.heading}</AppText>
            </View>
            <AppText style={{ lineHeight: 22 }}>{reportSection.body}</AppText>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}
