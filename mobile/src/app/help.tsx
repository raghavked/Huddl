import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, SectionLabel } from "@/components/ui";
import { space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { resetFirstRun } from "@/lib/first-run";
import { HELP_INTRO, HELP_SECTIONS } from "@/lib/help-content";

/* "How Huddl works". The welcome tour runs once, on the first launch, and
   most students will have swiped through it before they had any reason to
   care. This is where the same explanation waits for them afterwards.

   It reads like the legal screens rather than like the tour: no pager, no
   illustrations, no progress. Someone opening this has a question, and the
   fastest way to answer it is a scannable list of terms with one sentence
   each. The sentences live in lib/help-content.ts so the web page says
   exactly the same thing.

   The tour itself is at the bottom, as a button, because "show me that thing
   again" is a real request and burying it in a different screen would be
   unkind. */

export default function HelpScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, []);

  /* Clearing the flag is what makes the welcome willing to show again; the
     same pair settings uses. */
  const replayTour = useCallback(async () => {
    await resetFirstRun();
    router.push("/welcome");
  }, []);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
      }}
    >
      <View style={{ paddingHorizontal: space.gutter }}>
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
          paddingHorizontal: space.gutter,
          paddingBottom: insets.bottom + space.rest,
        }}
        showsVerticalScrollIndicator={false}
      >
        <AppText variant="display" style={{ marginTop: space.hair }}>
          How Huddl works
        </AppText>
        <AppText variant="body" muted style={{ marginTop: space.snug }}>
          {HELP_INTRO}
        </AppText>

        {HELP_SECTIONS.map((section) => (
          <View key={section.key}>
            <SectionLabel text={section.title} />
            {section.intro ? (
              <AppText
                variant="body"
                muted
                style={{ marginBottom: space.close }}
              >
                {section.intro}
              </AppText>
            ) : null}
            <Card style={{ gap: space.card }}>
              {section.items.map((item) => (
                <View key={item.term} style={{ gap: space.hair }}>
                  <AppText variant="bodySemi">{item.term}</AppText>
                  <AppText variant="body" muted>
                    {item.detail}
                  </AppText>
                </View>
              ))}
            </Card>
          </View>
        ))}

        <SectionLabel text="Still stuck" />
        <Card style={{ gap: space.close }}>
          <AppText variant="body" muted>
            The welcome tour is three screens and a short checklist. You can
            watch it as many times as you like.
          </AppText>
          <Button
            label="Replay the welcome tour"
            variant="soft"
            onPress={() => void replayTour()}
          />
        </Card>
      </ScrollView>
    </View>
  );
}
