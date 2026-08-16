/* The hearths, web side.
 *
 * The full palettes live in two generated places: `src/app/globals.css` holds
 * them as CSS custom properties keyed by `[data-scheme]`, and the native app
 * carries the same values in `mobile/src/constants/theme.ts`. Both come out
 * of `scripts/schemes.py`, which derives every scheme from Ember (same
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
  | "rose"
  | "peony"
  | "honey"
  | "gold"
  | "fern"
  | "tide"
  | "aggie"
  | "cobalt"
  | "slate"
  | "dusk"
  | "grape";

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
    id: "rose",
    label: "Rose",
    hint: "soft pink with red embers",
    preview: {
      light: { background: "#fdf4f3", foreground: "#2c1f1f", muted: "#6e5a5a", brand: "#be414e", accent: "#8a4762" },
      dark: { background: "#1c1515", foreground: "#f5e9e8", muted: "#b89e9d", brand: "#ec6670", accent: "#da779e" },
    },
  },
  {
    id: "peony",
    label: "Peony",
    hint: "hot pink in full bloom",
    preview: {
      light: { background: "#fbf4f7", foreground: "#292023", muted: "#695c60", brand: "#c02f83", accent: "#714f8a" },
      dark: { background: "#1b1618", foreground: "#f2e9ec", muted: "#b1a0a6", brand: "#ed57a9", accent: "#b582da" },
    },
  },
  {
    id: "honey",
    label: "Honey",
    hint: "amber and toasted gold",
    preview: {
      light: { background: "#fbf6ef", foreground: "#292218", muted: "#685e50", brand: "#a66100", accent: "#884f34" },
      dark: { background: "#1a1712", foreground: "#f2ebe2", muted: "#b1a390", brand: "#cc8400", accent: "#d8825b" },
    },
  },
  {
    id: "gold",
    label: "Gold",
    hint: "bold gold with blue trim",
    preview: {
      light: { background: "#f9f6f0", foreground: "#27231a", muted: "#655f52", brand: "#9c6900", accent: "#435f93" },
      dark: { background: "#191713", foreground: "#efece4", muted: "#aca493", brand: "#be8b00", accent: "#719be8" },
    },
  },
  {
    id: "fern",
    label: "Fern",
    hint: "greens out of the arboretum",
    preview: {
      light: { background: "#f5f7f3", foreground: "#21241f", muted: "#5d6159", brand: "#138a41", accent: "#636418" },
      dark: { background: "#161815", foreground: "#eaede8", muted: "#a1a79c", brand: "#3aa85d", accent: "#a1a234" },
    },
  },
  {
    id: "tide",
    label: "Tide",
    hint: "sea glass and deep teal",
    preview: {
      light: { background: "#f3f7f8", foreground: "#1e2526", muted: "#586264", brand: "#008b9f", accent: "#00725d" },
      dark: { background: "#151819", foreground: "#e7edef", muted: "#9ba8aa", brand: "#00a3b9", accent: "#00b697" },
    },
  },
  {
    id: "aggie",
    label: "Aggie",
    hint: "blue and gold, go Ags",
    preview: {
      light: { background: "#f4f7fa", foreground: "#202428", muted: "#5b6067", brand: "#396dd3", accent: "#7b5a00" },
      dark: { background: "#16181a", foreground: "#e9ecf1", muted: "#9ea6af", brand: "#5891fc", accent: "#c39300" },
    },
  },
  {
    id: "cobalt",
    label: "Cobalt",
    hint: "electric blue and cyan",
    preview: {
      light: { background: "#f4f7fb", foreground: "#202329", muted: "#5b6069", brand: "#4264e7", accent: "#007178" },
      dark: { background: "#16171b", foreground: "#e9ecf2", muted: "#9ea6b1", brand: "#618bff", accent: "#00b5bf" },
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
  {
    id: "dusk",
    label: "Dusk",
    hint: "violet, just after sunset",
    preview: {
      light: { background: "#f7f6fa", foreground: "#242228", muted: "#615e67", brand: "#8c58af", accent: "#5b588f" },
      dark: { background: "#18171a", foreground: "#edebf1", muted: "#a6a3af", brand: "#b37cda", accent: "#9490e2" },
    },
  },
  {
    id: "grape",
    label: "Grape",
    hint: "loud purple, berry bright",
    preview: {
      light: { background: "#f8f5fa", foreground: "#252228", muted: "#625d67", brand: "#a43dba", accent: "#8b4568" },
      dark: { background: "#18171a", foreground: "#eeebf0", muted: "#a9a2ae", brand: "#ce63e6", accent: "#db74a8" },
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
