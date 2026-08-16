/* The eight hearths, web side.
 *
 * The full palettes live in two generated places: `src/app/globals.css` holds
 * them as CSS custom properties keyed by `[data-scheme]`, and the native app
 * carries the same values in `mobile/src/constants/theme.ts`. Both come out
 * of `scratchpad/schemes.py`, which derives every scheme from Ember (same
 * OKLCH lightness curve, same chroma relationships, different hue families)
 * and proves the same WCAG pairs Ember passes in both appearances. A test
 * keeps all three files agreeing, so do not hand-edit a hex in any of them:
 * change the recipe and re-run.
 *
 * This module owns the choice itself: which scheme is stored, how it lands
 * on the document, and the handful of literal colours the appearance page
 * needs to draw its preview cards (literal because a card previews a scheme
 * that is not the one currently applied, so it cannot read the CSS vars).
 *
 * The mechanism mirrors the theme toggle next to it: localStorage key, a
 * data attribute on <html>, and a boot script in the root layout that
 * replays the choice before first paint. Ember is the default and stores
 * nothing, so an untouched browser keeps behaving exactly as before.
 */

export type HearthId =
  | "ember"
  | "aggie"
  | "rose"
  | "fern"
  | "tide"
  | "dusk"
  | "honey"
  | "slate";

export const SCHEME_KEY = "hearth-scheme";

export const SCHEME_DEFAULT: HearthId = "ember";

/** The tokens a preview card paints with, per appearance. */
export type SchemePreview = {
  background: string;
  foreground: string;
  muted: string;
  brand: string;
  accent: string;
};

/**
 * The picker's order and words, word for word with `HEARTHS` in
 * mobile/src/constants/theme.ts. `hint` finishes the sentence
 * "<Label>, <hint>" in the option's accessibility label.
 */
export const SCHEMES: {
  id: HearthId;
  label: string;
  hint: string;
  preview: { light: SchemePreview; dark: SchemePreview };
}[] = [
  {
    id: "ember",
    label: "Ember",
    hint: "the original clay and cream",
    preview: {
      light: { background: "#faf6ee", foreground: "#2b2118", muted: "#6b5d4f", brand: "#b5502f", accent: "#56682d" },
      dark: { background: "#1c1612", foreground: "#f2ebe1", muted: "#b3a28e", brand: "#e0764b", accent: "#8ba852" },
    },
  },
  {
    id: "aggie",
    label: "Aggie",
    hint: "blue and gold, go Ags",
    preview: {
      light: { background: "#f4f7f9", foreground: "#202427", muted: "#5c6065", brand: "#4470c4", accent: "#775b15" },
      dark: { background: "#161819", foreground: "#e9ecf0", muted: "#a0a6ac", brand: "#6393ed", accent: "#bf9530" },
    },
  },
  {
    id: "rose",
    label: "Rose",
    hint: "soft pink with red embers",
    preview: {
      light: { background: "#fdf4f4", foreground: "#2c201f", muted: "#6d5b5a", brand: "#b64b53", accent: "#864a61" },
      dark: { background: "#1c1615", foreground: "#f5e9e8", muted: "#b79e9d", brand: "#e26f76", accent: "#d57b9e" },
    },
  },
  {
    id: "fern",
    label: "Fern",
    hint: "greens out of the arboretum",
    preview: {
      light: { background: "#f5f7f4", foreground: "#22241f", muted: "#5d615a", brand: "#3b854f", accent: "#636423" },
      dark: { background: "#171815", foreground: "#eaede8", muted: "#a2a79d", brand: "#59a36b", accent: "#a0a242" },
    },
  },
  {
    id: "tide",
    label: "Tide",
    hint: "sea glass and deep teal",
    preview: {
      light: { background: "#f3f7f8", foreground: "#1e2426", muted: "#596263", brand: "#008796", accent: "#1c6f5d" },
      dark: { background: "#151819", foreground: "#e8edee", muted: "#9ca8aa", brand: "#00a2b2", accent: "#3bb297" },
    },
  },
  {
    id: "dusk",
    label: "Dusk",
    hint: "violet, just after sunset",
    preview: {
      light: { background: "#f7f6f9", foreground: "#242227", muted: "#615e66", brand: "#885da7", accent: "#5b598a" },
      dark: { background: "#18171a", foreground: "#edebf0", muted: "#a6a3ae", brand: "#af81d0", accent: "#9592db" },
    },
  },
  {
    id: "honey",
    label: "Honey",
    hint: "amber and toasted gold",
    preview: {
      light: { background: "#fbf6ef", foreground: "#292218", muted: "#685e50", brand: "#9f6500", accent: "#85513a" },
      dark: { background: "#1a1712", foreground: "#f2ebe2", muted: "#b1a390", brand: "#c58814", accent: "#d28663" },
    },
  },
  {
    id: "slate",
    label: "Slate",
    hint: "cool blue-grey and quiet",
    preview: {
      light: { background: "#f5f7f8", foreground: "#212426", muted: "#5c6063", brand: "#46799c", accent: "#346878" },
      dark: { background: "#161819", foreground: "#eaecee", muted: "#a0a6aa", brand: "#659bbe", accent: "#5ba8bf" },
    },
  },
];

/** True when a value read back from storage names a real scheme. */
export function isHearthId(value: unknown): value is HearthId {
  return (
    typeof value === "string" && SCHEMES.some((scheme) => scheme.id === value)
  );
}

/** The stored scheme, or Ember when there isn't one (or storage is locked). */
export function readScheme(): HearthId {
  if (typeof window === "undefined") return SCHEME_DEFAULT;
  try {
    const stored = localStorage.getItem(SCHEME_KEY);
    return isHearthId(stored) ? stored : SCHEME_DEFAULT;
  } catch {
    return SCHEME_DEFAULT;
  }
}

/** The stored theme preference, same rules as the theme toggle's own read. */
export function readThemePref(): "light" | "dark" | "system" {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem("hearth-theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/**
 * Keep the browser-chrome colour in step with whatever combination of scheme
 * and theme is in effect. With the theme on "system" each meta keeps its own
 * media query and gets that scheme's half; a pinned theme pins both metas.
 */
export function syncThemeColorMeta() {
  const scheme =
    SCHEMES.find((option) => option.id === readScheme()) ?? SCHEMES[0];
  const pref = readThemePref();
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => {
      if (pref === "system") {
        meta.content = meta.media.includes("dark")
          ? scheme.preview.dark.background
          : scheme.preview.light.background;
      } else {
        meta.content = scheme.preview[pref].background;
      }
    });
}

/**
 * Stamp a scheme on the document and remember it. Ember removes the
 * attribute and the key outright, so the base tokens in globals.css take
 * back over and an untouched browser stays untouched.
 */
export function applyScheme(id: HearthId) {
  if (id === SCHEME_DEFAULT) {
    delete document.documentElement.dataset.scheme;
  } else {
    document.documentElement.dataset.scheme = id;
  }
  try {
    if (id === SCHEME_DEFAULT) localStorage.removeItem(SCHEME_KEY);
    else localStorage.setItem(SCHEME_KEY, id);
  } catch {
    // It applies for this session; it just won't survive a reload.
  }
  syncThemeColorMeta();
}
