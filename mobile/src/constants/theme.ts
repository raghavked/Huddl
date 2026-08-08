/* Hearth (v3) design tokens, ported from the web app's globals.css.
   Same names, same hex values, same AA-checked pairs — one brand,
   two runtimes. Dark is the candle-lit den: warm browns, never blue. */

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
