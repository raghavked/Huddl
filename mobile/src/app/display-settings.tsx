import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { Animated, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Lantern } from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  Chip,
  SectionLabel,
  useReducedMotion,
} from "@/components/ui";
import {
  motion,
  palettes,
  radius,
  space,
  type Palette,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { tapLight } from "@/lib/haptics";
import {
  TEXT_SCALE_DEFAULT,
  TEXT_SCALE_STEPS,
  useDisplay,
  type DisplayMode,
} from "@/providers/display-provider";

/* Look and feel — appearance and type size, both of them local to this
   phone. Everything here applies on the tap: there is nothing to save, no
   server round trip, and so no loading or error state to render. The whole
   screen is its own preview — choose dark and the page you are standing on
   goes dark under your finger. */

/* ------------------------------ appearance ------------------------------ */

const MODES: { mode: DisplayMode; label: string; hint: string }[] = [
  { mode: "system", label: "System", hint: "follows your phone" },
  { mode: "light", label: "Light", hint: "warm cream, all day" },
  { mode: "dark", label: "Dark", hint: "candle-lit and low" },
];

/**
 * One pane of a theme preview, painted entirely in the *other* palette's
 * tokens rather than the active one — that is the whole point: you can see
 * light while standing in dark.
 *
 * The numbers inside are off the spacing ladder deliberately. This is a
 * drawing of a screen at about a sixth scale, not a screen — 7 and 5 and the
 * 11px dot are the proportions of the picture, and snapping them to rungs
 * meant for real layout would only distort it.
 */
function PalettePane({ palette }: { palette: Palette }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.background,
        paddingHorizontal: 7,
        paddingVertical: space.cosy,
        justifyContent: "flex-end",
        gap: 5,
      }}
    >
      <View
        style={{
          width: 11,
          height: 11,
          borderRadius: radius.full,
          backgroundColor: palette.brand,
          marginBottom: 3,
        }}
      />
      <View
        style={{
          height: 5,
          width: "82%",
          borderRadius: radius.full,
          backgroundColor: palette.foreground,
        }}
      />
      <View
        style={{
          height: 4,
          width: "52%",
          borderRadius: radius.full,
          backgroundColor: palette.muted,
        }}
      />
    </View>
  );
}

/** Light and dark get one pane; "system" gets both, split down the middle. */
function ModePreview({ mode }: { mode: DisplayMode }) {
  const theme = useTheme();
  return (
    <View
      // Pure decoration — the card's own label is what a screen reader needs.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height: 64,
        flexDirection: "row",
        borderRadius: radius.control,
        borderWidth: 1,
        borderColor: theme.border,
        overflow: "hidden",
      }}
    >
      {mode !== "dark" ? <PalettePane palette={palettes.light} /> : null}
      {mode !== "light" ? <PalettePane palette={palettes.dark} /> : null}
    </View>
  );
}

function ModeCard({
  option,
  selected,
  onPress,
}: {
  option: (typeof MODES)[number];
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();

  /* The check reports a completed choice, so it earns its 140ms — in and
     out along the house `standard` curve, because choosing is reversible. */
  const check = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(check, {
      toValue: selected ? 1 : 0,
      duration: reduceMotion ? motion.instant : motion.quick,
      easing: motion.easing.standard,
      useNativeDriver: true,
    }).start();
  }, [selected, reduceMotion, check]);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${option.label} appearance, ${option.hint}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        // The ring lives outside the card so selecting never nudges layout.
        padding: 3,
        borderRadius: radius.card + 3,
        borderWidth: 2,
        borderColor: selected ? theme.brand : "transparent",
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Card padded={false} style={{ padding: space.cosy, gap: space.cosy }}>
        <ModePreview mode={option.mode} />
        <AppText
          variant="label"
          numberOfLines={1}
          style={{
            textAlign: "center",
            color: selected ? theme.brandInk : theme.muted,
          }}
        >
          {option.label}
        </AppText>

        {/* Stamped on the preview rather than hung off the card's corner:
            an Android sibling with elevation would otherwise draw over it. */}
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: "absolute",
            top: 5,
            right: 5,
            width: 22,
            height: 22,
            borderRadius: radius.full,
            backgroundColor: theme.brand,
            alignItems: "center",
            justifyContent: "center",
            opacity: check,
            transform: [
              {
                scale: check.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.6, 1],
                }),
              },
            ],
          }}
        >
          <Feather name="check" size={12} color={theme.brandFg} />
        </Animated.View>
      </Card>
    </Pressable>
  );
}

/* ------------------------------- text size ------------------------------- */

/* The provider owns the numbers; the warm names for them belong here. */
const SIZE_NAMES: Record<string, string> = {
  "0.9": "Compact",
  "1": "Default",
  "1.15": "Roomy",
  "1.3": "Large",
  "1.4": "Largest",
};

/** Floats read back from storage never land exactly, so compare with slack. */
function sameScale(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

function nameForScale(scale: number): string {
  const step = TEXT_SCALE_STEPS.find((value) => sameScale(value, scale));
  return (step === undefined ? undefined : SIZE_NAMES[String(step)]) ?? "Custom";
}

/**
 * One notch of the segmented control: an A drawn at that step's own size,
 * deliberately ignoring the current preference so the five of them stay a
 * ladder you can read at a glance.
 */
function SizeStep({
  scale,
  name,
  selected,
  onPress,
}: {
  scale: number;
  name: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const size = Math.round(16 * scale);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${name} text size`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.full,
        backgroundColor: selected ? theme.brandSoft : "transparent",
        borderWidth: 1,
        borderColor: selected ? theme.brandInk : "transparent",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <AppText
        variant="title"
        style={{
          fontSize: size,
          lineHeight: Math.round(size * 1.3),
          color: selected ? theme.brandInk : theme.muted,
        }}
      >
        A
      </AppText>
    </Pressable>
  );
}

/* -------------------------------- screen -------------------------------- */

export default function DisplaySettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { mode, setMode, textScale, setTextScale } = useDisplay();

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, []);

  const chooseMode = useCallback(
    (next: DisplayMode) => {
      if (next === mode) return;
      tapLight();
      setMode(next);
    },
    [mode, setMode]
  );

  const chooseScale = useCallback(
    (next: number) => {
      if (sameScale(next, textScale)) return;
      tapLight();
      setTextScale(next);
    },
    [textScale, setTextScale]
  );

  const isDefaultScale = sameScale(textScale, TEXT_SCALE_DEFAULT);

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
        style={{ marginTop: space.hair }}
      >
        Look and feel
      </AppText>
      <AppText variant="caption" muted style={{ marginTop: space.tight }}>
        Set the appearance and the type size. Both take hold the moment you
        tap.
      </AppText>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel text="Appearance" />

        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Appearance"
          style={{ flexDirection: "row", gap: space.cosy }}
        >
          {MODES.map((option) => (
            <ModeCard
              key={option.mode}
              option={option}
              selected={mode === option.mode}
              onPress={() => chooseMode(option.mode)}
            />
          ))}
        </View>

        <AppText variant="caption" muted style={{ marginTop: space.room }}>
          System flips whenever your phone does. Light is the warm cream one;
          dark is the candle-lit one, made for a late library table.
        </AppText>

        <SectionLabel text="Text size" />

        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Text size"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.tight,
            padding: space.tight,
            borderRadius: radius.full,
            backgroundColor: theme.surface2,
          }}
        >
          {TEXT_SCALE_STEPS.map((step) => (
            <SizeStep
              key={step}
              scale={step}
              name={nameForScale(step)}
              selected={sameScale(textScale, step)}
              onPress={() => chooseScale(step)}
            />
          ))}
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.cosy,
            minHeight: 40,
            marginTop: space.room,
          }}
        >
          {/* The one thing on the screen that reports the choice you just
              made, so it says the new name rather than going quietly stale. */}
          <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${nameForScale(textScale)} text size`}
          >
            <Chip
              label={nameForScale(textScale)}
              tone="brand"
              size="md"
              icon="type"
            />
          </View>
          {isDefaultScale ? null : (
            <Button
              label="Reset to default"
              variant="ghost"
              size="sm"
              accessibilityLabel="Reset the text size to default"
              onPress={() => chooseScale(TEXT_SCALE_DEFAULT)}
              style={{ marginRight: -16 }}
            />
          )}
        </View>

        <AppText variant="caption" muted style={{ marginTop: space.card }}>
          Here's how a post reads at that size:
        </AppText>

        <Card style={{ gap: space.snug, marginTop: space.cosy }}>
          <AppText variant="title">Thursday night, Shields third floor</AppText>
          <AppText variant="body">
            I'm camping out with the practice midterm from 7 until they kick us
            out. Bring questions, I'll bring the coffee and the good pens.
          </AppText>
          <AppText variant="caption" muted>
            Posted 12 minutes ago in ECS 36A
          </AppText>
        </Card>

        <View style={{ alignItems: "center", gap: space.cosy, marginTop: space.rest }}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Lantern size={56} color={theme.muted} softColor={theme.surface2} />
          </View>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 300 }}
          >
            Both settings stay on this phone and change nothing but how Huddl
            looks to you — not your profile, not your classes, and not a thing
            anyone else sees.
          </AppText>
        </View>
      </ScrollView>
    </View>
  );
}
