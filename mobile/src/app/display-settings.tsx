import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  View,
} from "react-native";
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

/* Look and feel: appearance, type size, and the tick you feel, all three of
   them local to this phone. Everything here applies on the tap. There is
   nothing to save, no server round trip, and so no loading or error state to
   render. The only read that can fail is the provider's one pass at
   AsyncStorage on launch, which answers failure with the defaults behind the
   splash screen, so by the time this screen can be reached the three
   preferences are known and `ready` is long since true. The whole screen is
   its own preview: choose dark and the page you are standing on goes dark
   under your finger, switch the tick on and it ticks.

   Haptics belong here rather than under Notifications: that screen is about
   what Hearth sends you, this one is about how it comes across in your hand,
   and "feel" was the half of the title nothing on the screen was honouring. */

/* ------------------------------ appearance ------------------------------ */

const MODES: { mode: DisplayMode; label: string; hint: string }[] = [
  { mode: "system", label: "System", hint: "follows your phone" },
  { mode: "light", label: "Light", hint: "warm cream, all day" },
  { mode: "dark", label: "Dark", hint: "candle-lit and low" },
];

/**
 * One pane of a theme preview, painted entirely in the *other* palette's
 * tokens rather than the active one. That is the whole point: you can see
 * light while standing in dark.
 *
 * The numbers inside are off the spacing ladder deliberately. This is a
 * drawing of a screen at about a sixth scale, not a screen. The 7 and the 5
 * and the 11px dot are the proportions of the picture, and snapping them to
 * rungs meant for real layout would only distort it.
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
      // Pure decoration; the card's own label is what a screen reader needs.
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

  /* The check reports a completed choice, so it earns its 140ms, in and
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

/* -------------------------------- haptics -------------------------------- */

/* A browser has nothing to buzz, and `@/lib/haptics` already no-ops there.
   The row still gets drawn rather than hidden, so the setting is where a
   student went looking for it. It just says why it is doing nothing. */
const CAN_BUZZ = Platform.OS !== "web";

/**
 * What the switch currently means, in a sentence under the card. Same shape
 * privacy-settings uses, and for the same reason: a switch says on or off, it
 * does not say what that bought you.
 */
function hapticsSentence(enabled: boolean): string {
  if (!CAN_BUZZ) {
    return "Hearth only taps back on a phone, so there's nothing here for this switch to quiet.";
  }
  if (enabled) {
    return "It's on, which is how Hearth starts out. The tick only marks something finishing: never a keystroke, never a tab, never twice for the same thing.";
  }
  return "It's off. Your phone stays still, and nothing else changes. Messages send, check-offs save, and notifications arrive exactly as you set them.";
}

/**
 * Icon tile + label + caption + a switch, in the push-settings idiom.
 *
 * That makes three hand-rolled copies of this row (push-settings,
 * privacy-settings, here), which by §8 of the design language is the moment
 * it should become a `SwitchRow` primitive. It is not one yet because
 * promoting it means editing `components/ui` and rewriting two other screens
 * on top of a one-setting change. Whoever writes the fourth: stop and lift
 * it instead.
 */
function HapticsRow({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const theme = useTheme();
  /* Where there is nothing to buzz the row dims and the switch stops taking
     taps, but it still shows the stored preference rather than a flat off:
     the setting is real, it just isn't this device's to exercise. */
  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: space.close,
        paddingHorizontal: space.card,
        paddingVertical: space.close,
        opacity: CAN_BUZZ ? 1 : 0.5,
      }}
    >
      <View
        // The switch's own label says all of this, and says the state too.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: radius.control,
            backgroundColor: value ? theme.brandSoft : theme.surface2,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather
            name="smartphone"
            size={16}
            color={value ? theme.brand : theme.muted}
          />
        </View>
        <View style={{ flex: 1, gap: space.hair }}>
          <AppText variant="bodySemi">Haptic taps</AppText>
          <AppText variant="caption" muted>
            A short tick at the end of something: a message sent, a task
            checked off.
          </AppText>
        </View>
      </View>
      <Switch
        accessibilityRole="switch"
        accessibilityLabel="Haptic taps. A short tick at the end of something: a message sent, a task checked off."
        accessibilityState={{ checked: value, disabled: !CAN_BUZZ }}
        disabled={!CAN_BUZZ}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.surface3, true: theme.brand }}
        thumbColor={theme.onSolid}
        ios_backgroundColor={theme.surface3}
      />
    </View>
  );
}

/* -------------------------------- screen -------------------------------- */

export default function DisplaySettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { mode, setMode, textScale, setTextScale, haptics, setHaptics } =
    useDisplay();

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

  const chooseHaptics = useCallback(
    (next: boolean) => {
      setHaptics(next);
      /* Turning them on is the one choice on this screen that can answer in
         the medium it just switched on, so it ticks once: the setting
         demonstrating itself, not a new haptic moment. Turning them off
         answers with silence, which is the only honest confirmation there
         is. The order matters: `setHaptics` writes the preference through to
         `@/lib/haptics` synchronously, so by this line the tap is allowed. */
      if (next) tapLight();
    },
    [setHaptics]
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
        Set the appearance, the type size, and whether Hearth taps back. All
        three take hold the moment you tap.
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

        <SectionLabel text="Haptics" />

        <Card padded={false}>
          <HapticsRow value={haptics} onValueChange={chooseHaptics} />
        </Card>

        <AppText variant="caption" muted style={{ marginTop: space.room }}>
          {hapticsSentence(haptics)}
        </AppText>

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
            All three stay on this phone. They change how Hearth looks and
            feels to you, nothing else: not your profile, not your classes,
            not a thing anyone else sees.
          </AppText>
        </View>
      </ScrollView>
    </View>
  );
}
