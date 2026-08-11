/* Hearth (v3) design tokens, ported from the web app's globals.css.
   Same names, same hex values, same AA-checked pairs — one brand,
   two runtimes. Dark is the candle-lit den: warm browns, never blue. */

import { Easing, type ViewStyle } from "react-native";

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

/* ----------------------------- course tints ----------------------------- */

/**
 * The six colours a student can hang on a course, matching the values
 * `enrollments.color` accepts. The name is what we store and what the picker
 * shows; the colours themselves live in `courseTints`.
 *
 * The rule for turning a course into one of these — the student's pick when
 * they made one, a stable hash of the course code when they didn't — lives in
 * `@/lib/course-color`, not here. This file only owns the paint.
 */
export type CourseTint = "ember" | "fern" | "clay" | "plum" | "sky" | "sand";

/**
 * One tint: the wash a course sits on, and the ink that reads on that wash.
 *
 * `soft` is a fill — a chip, a calendar block, the stripe down a card. `ink`
 * is the text and the icons *on* that fill, and it is dark enough in light
 * and bright enough in dark to also work as a standalone mark (a dot, a bar,
 * the course code) on `background`, `surface`, or `surface2`.
 *
 * There is deliberately no saturated third step. A course colour is a label,
 * not a call to action — the ember stays the only thing in the app that fills
 * a button.
 */
export type CourseTintColors = { soft: string; ink: string };

export type CourseTintScale = Record<CourseTint, CourseTintColors>;

/**
 * The course palette, both appearances.
 *
 * **Ember and fern are the brand and accent pairs, unchanged.** A course the
 * student tinted ember is wearing the same clay wash as every brand chip in
 * the app, so a coloured course sits *inside* the hearth rather than beside
 * it. The other four are new, and they are held to the same standard: warm,
 * low chroma, and quiet enough that six of them in a week view read as a
 * calendar rather than a highlighter drawer.
 *
 * How they were tuned:
 *
 * - **Every `ink` on its own `soft` clears 4.5:1** in both themes — 5.15 to
 *   6.05 in light, 5.26 to 7.58 in dark. Ink on `background` and on `surface`
 *   clears it too (5.7 minimum), so the code can be set in its colour on a
 *   plain card.
 * - **The six fills stay apart.** No two `soft` fills in a theme are closer
 *   than ΔE 9.2 (light) or 8.3 (dark) in CIE Lab, so adjacent rows are
 *   distinguishable without reading the label.
 * - **The six fills stay level.** Light fills sit in an L\* band of 89–93 and
 *   dark in 17.6–19.1, so no one course looks heavier than its neighbours.
 * - **A course keeps its identity across themes.** Each tint holds its hue
 *   within a few degrees between light and dark; only the lightness flips.
 *
 * Colour is never the only signal — the course code is always rendered next
 * to the tint, so a student who cannot separate two of these still reads the
 * row correctly.
 */
export const courseTints: { light: CourseTintScale; dark: CourseTintScale } = {
  light: {
    /* The brand pair, verbatim: brandSoft / brandInk. */
    ember: { soft: "#f6e3d7", ink: "#8f3a1f" },
    /* The accent pair, verbatim: accentSoft / accent. */
    fern: { soft: "#e9edd8", ink: "#56682d" },
    /* Unfired rose-brick. Sits opposite ember so the two don't blur. */
    clay: { soft: "#f9d9dc", ink: "#8e3f48" },
    /* Dried plum skin — the one violet, kept greyed. */
    plum: { soft: "#ecdcf1", ink: "#6f4482" },
    /* Faded chambray. The coolest thing we allow, and barely. */
    sky: { soft: "#d3e6eb", ink: "#3b5e6a" },
    /* Wheat and dry grass, one step off the cream page. */
    sand: { soft: "#f2e5c4", ink: "#77591f" },
  },
  dark: {
    ember: { soft: "#40291c", ink: "#eda07b" },
    fern: { soft: "#262e1a", ink: "#8ba852" },
    clay: { soft: "#402326", ink: "#e79fa5" },
    plum: { soft: "#352339", ink: "#cba3d5" },
    sky: { soft: "#1d3035", ink: "#8fc1cb" },
    sand: { soft: "#362d19", ink: "#dabf7c" },
  },
};

/**
 * The course palette for the active appearance. Feed it `useColorScheme()` —
 * anything that isn't an explicit "dark" falls back to light, the same way
 * `elevationFor` and `useTheme()` do.
 *
 * `const tint = courseTintsFor(scheme)[colorForCourse(enrollment.color, course.code)];`
 */
export function courseTintsFor(
  scheme: "light" | "dark" | "unspecified" | null | undefined
): CourseTintScale {
  return scheme === "dark" ? courseTints.dark : courseTints.light;
}

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
 * Durations in milliseconds, and the three curves they travel along. Four
 * durations and three easings — that is the whole budget.
 *
 * - `instant` (0) — the reduced-motion value. Pass it as the duration
 *   instead of branching around the animation, so state still lands.
 * - `quick` (140) — press feedback, a chip selecting, a checkbox filling.
 *   Fast enough to feel like a direct consequence of the finger.
 * - `base` (240) — the house default. Sheets, expanding cards, list rows
 *   settling in, anything that "arrives".
 * - `slow` (320) — full-screen transitions and the skeleton pulse. Rare.
 *
 * **House easing** — `motion.easing`, so nothing has to reach for
 * `react-native`'s `Easing` and invent a fourth curve:
 *
 * - `standard` (`inOut` cubic) — anything **reversible**: press in and out,
 *   open and close, select and deselect. It leaves and returns along the
 *   same curve, so the undo feels like the same gesture backwards. When you
 *   are not sure, this is the one.
 * - `enter` (`out` cubic) — **arrivals.** Something appearing that will not
 *   immediately leave: a newly inserted row, a card landing on a first
 *   paint, a button settling back under a lifted finger. Fast off the mark,
 *   slow into place.
 * - `exit` (`in` cubic) — **departures.** Something on its way out: a
 *   dismissed sheet, a row being removed. Slow to let go, then gone. Never
 *   use it for something arriving; an arrival that accelerates away from
 *   you reads as a glitch.
 *
 * Arrivals and departures are asymmetric on purpose. A thing takes its time
 * settling in and leaves without lingering, which is roughly how objects
 * behave and exactly how a press should feel: quick in, slower out.
 *
 * **The rule: motion is for arrival and completion, never decoration.**
 * Animate a thing that just appeared, or a thing the user just finished.
 * Nothing loops, nothing bounces to get noticed, nothing moves because the
 * screen would otherwise be still. If you cannot name the moment the
 * animation is reporting, delete it.
 *
 * **And every animation is gated on `useReducedMotion()`.** Not "animate
 * less" — land the final state in `motion.instant`. A primitive that cannot
 * be turned off this way is not finished.
 */
export const motion = {
  instant: 0,
  quick: 140,
  base: 240,
  slow: 320,
  easing: {
    standard: Easing.inOut(Easing.cubic),
    enter: Easing.out(Easing.cubic),
    exit: Easing.in(Easing.cubic),
  },
} as const;
