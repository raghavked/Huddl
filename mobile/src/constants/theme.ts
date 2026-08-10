/* Hearth (v3) design tokens, ported from the web app's globals.css.
   Same names, same hex values, same AA-checked pairs — one brand,
   two runtimes. Dark is the candle-lit den: warm browns, never blue. */

import type { ViewStyle } from "react-native";

export const palettes = {
  light: {
    background: "#faf6ee",
    foreground: "#2b2118",
    surface: "#fffcf5",
    surface2: "#f3ecdd",
    surface3: "#eae1cd",
    border: "#e6dcc8",
    muted: "#6b5d4f",
    brand: "#b5502f",
    brandStrong: "#9c3f22",
    brandSoft: "#f6e3d7",
    brand2: "#d97742",
    brandFg: "#ffffff",
    brandInk: "#8f3a1f",
    onSolid: "#ffffff",
    accent: "#56682d",
    accentSoft: "#e9edd8",
    success: "#25683f",
    danger: "#b32d2d",
    warning: "#8a5c00",
  },
  dark: {
    background: "#1c1612",
    foreground: "#f2ebe1",
    surface: "#262019",
    surface2: "#322a21",
    surface3: "#3e352a",
    border: "#453b2e",
    muted: "#b3a28e",
    brand: "#e0764b",
    brandStrong: "#cf5f33",
    brandSoft: "#40291c",
    brand2: "#e8955f",
    brandFg: "#2b1408",
    brandInk: "#eda07b",
    onSolid: "#ffffff",
    accent: "#8ba852",
    accentSoft: "#262e1a",
    success: "#4caf7d",
    danger: "#e06060",
    warning: "#d9a13a",
  },
} as const;

export type Palette = { [K in keyof (typeof palettes)["light"]]: string };

export const radius = {
  card: 20,
  control: 12,
  full: 999,
} as const;

export const fonts = {
  /* Loaded in the root layout via @expo-google-fonts. */
  display: "BricolageGrotesque_700Bold",
  displaySemi: "BricolageGrotesque_600SemiBold",
  body: "PlusJakartaSans_400Regular",
  bodyMedium: "PlusJakartaSans_500Medium",
  bodySemi: "PlusJakartaSans_600SemiBold",
  bodyBold: "PlusJakartaSans_700Bold",
} as const;

/* ------------------------------ elevation ------------------------------ */

/** The three rungs of the shadow ladder. */
export type ElevationStep = "rest" | "raised" | "floating";

export type ElevationScale = Record<ElevationStep, ViewStyle>;

/* Shadows in the hearth world are warm: they read as lamplight falling
   past a real object, not as a grey drop-shadow from a spec sheet. Both
   inks come out of the palette rather than a one-off literal — espresso
   foreground in light, the deepest candle-brown we own in dark. */
const shadowInk = {
  light: palettes.light.foreground,
  dark: palettes.dark.background,
} as const;

/**
 * Warm, low-contrast shadow scale — three steps, both appearances.
 *
 * - `rest` — cards sitting on the page. This is the default for `Card`
 *   and should cover nine surfaces in ten.
 * - `raised` — something the user lifted off the page: a menu, a popover,
 *   a row that is mid-drag, a floating compose button.
 * - `floating` — the top of the stack: bottom sheets and modals, the one
 *   thing on screen while it is open.
 *
 * Dark mode leans on **surface contrast**, not shadow. A brown shadow on a
 * candle-dark background is nearly invisible, and cranking the opacity to
 * make it show reads as soot. So the dark values are deliberately softer —
 * `rest` drops the Android elevation to zero entirely — and depth in the
 * dark theme comes from `surface` / `surface2` / `surface3` stepping up
 * away from `background` plus the hairline `border`.
 *
 * Spread a step straight into a style object:
 * `style={{ ...elevationFor(scheme).raised, backgroundColor: theme.surface }}`
 */
export const elevation: { light: ElevationScale; dark: ElevationScale } = {
  light: {
    rest: {
      shadowColor: shadowInk.light,
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    raised: {
      shadowColor: shadowInk.light,
      shadowOpacity: 0.1,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 5,
    },
    floating: {
      shadowColor: shadowInk.light,
      shadowOpacity: 0.16,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 14 },
      elevation: 10,
    },
  },
  dark: {
    rest: {
      shadowColor: shadowInk.dark,
      shadowOpacity: 0.1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 0,
    },
    raised: {
      shadowColor: shadowInk.dark,
      shadowOpacity: 0.14,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 5 },
      elevation: 3,
    },
    floating: {
      shadowColor: shadowInk.dark,
      shadowOpacity: 0.22,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8,
    },
  },
};

/**
 * The elevation set for the active appearance. Feed it `useColorScheme()`
 * — anything that isn't an explicit "dark" (null, undefined, the
 * "unspecified" scheme before the system has answered) falls back to
 * light, the same way `useTheme()` does.
 */
export function elevationFor(
  scheme: "light" | "dark" | "unspecified" | null | undefined
): ElevationScale {
  return scheme === "dark" ? elevation.dark : elevation.light;
}

/* -------------------------------- motion -------------------------------- */

/**
 * Durations, in milliseconds. Four of them, and that is the whole budget.
 *
 * - `instant` (0) — the reduced-motion value. Pass it as the duration
 *   instead of branching around the animation, so state still lands.
 * - `quick` (140) — press feedback, a chip selecting, a checkbox filling.
 *   Fast enough to feel like a direct consequence of the finger.
 * - `base` (240) — the house default. Sheets, expanding cards, list rows
 *   settling in, anything that "arrives".
 * - `slow` (320) — full-screen transitions and the skeleton pulse. Rare.
 *
 * **House easing** (from `react-native`'s `Easing`):
 * - `Easing.inOut(Easing.cubic)` for anything **reversible** — press in and
 *   out, open and close, select and deselect. It leaves and returns along
 *   the same curve, so the undo feels like the same gesture backwards.
 * - `Easing.out(Easing.cubic)` for **arrivals** — something entering that
 *   will not immediately leave: a toast, a newly inserted row, a first
 *   paint. Fast off the mark, settles gently.
 *
 * **The rule: motion is for arrival and completion, never decoration.**
 * Animate a thing that just appeared, or a thing the user just finished.
 * Nothing loops, nothing bounces to get noticed, nothing moves because the
 * screen would otherwise be still. If you cannot name the moment the
 * animation is reporting, delete it.
 */
export const motion = {
  instant: 0,
  quick: 140,
  base: 240,
  slow: 320,
} as const;
