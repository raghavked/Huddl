import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import {
  HEARTH_DEFAULT,
  isHearthId,
  type HearthId,
} from "@/constants/theme";
import { setHapticsEnabled } from "@/lib/haptics";

/**
 * Display preferences: appearance, colour scheme, type size, and whether the
 * phone taps back.
 *
 * One provider, mounted at the very top of the tree, owns them all. Everything
 * that paints reads the resolved answer from here rather than asking the
 * device directly, so an explicit light/dark choice actually sticks instead
 * of being overruled by the phone's setting.
 *
 * The hearth (which of the eight colour schemes to paint in) is a sibling of
 * the light/dark mode, not a mode itself: every hearth has a light and a dark
 * half, and the two choices compose. `useTheme()` is where they meet.
 *
 * All of these live in AsyncStorage and are read once on mount. `ready` is
 * false until that read finishes; the root layout holds the splash screen up
 * until then so a student who picked the candle-lit dark never gets a flash
 * of cream on launch.
 *
 * Haptics are the odd one out and worth a sentence. Nothing renders them, so
 * nobody subscribes to them; they are consumed by `tapLight()` and friends in
 * `@/lib/haptics`, which are plain module functions called from hundreds of
 * places and cannot read a context. So this provider mirrors the value into
 * that module with `setHapticsEnabled` (once when the stored value lands and
 * again on every change) and keeps it in state as well so the settings
 * screen has something to render. Storage stays here, with the other two.
 * A second store for one boolean is how preferences start disagreeing.
 */

export type DisplayMode = "system" | "light" | "dark";

export type ColorScheme = "light" | "dark";

export type DisplayState = {
  /** What the student chose. "system" defers to the device. */
  mode: DisplayMode;
  setMode: (mode: DisplayMode) => void;
  /** Which of the eight colour schemes this phone paints in. */
  hearth: HearthId;
  setHearth: (hearth: HearthId) => void;
  /** Type size multiplier, always inside [TEXT_SCALE_MIN, TEXT_SCALE_MAX]. */
  textScale: number;
  setTextScale: (scale: number) => void;
  /** Whether the small completion taps fire. On unless it was turned off. */
  haptics: boolean;
  setHaptics: (enabled: boolean) => void;
  /** The appearance actually in effect right now. */
  resolvedScheme: ColorScheme;
  /** False until the stored preferences have been read from disk. */
  ready: boolean;
};

/* ------------------------------- text scale ------------------------------ */

/** Below this, captions stop being legible. */
export const TEXT_SCALE_MIN = 0.9;
/** Above this, two-line rows and 44px controls start to break. */
export const TEXT_SCALE_MAX = 1.4;
/** The default: the sizes the design was drawn at. */
export const TEXT_SCALE_DEFAULT = 1;

/** The steps a settings screen should offer. Labels are the screen's job. */
export const TEXT_SCALE_STEPS = [0.9, 1, 1.15, 1.3, 1.4] as const;

/**
 * Force any number, including a garbage value read back from storage, into
 * the safe range. Anything unusable (NaN, Infinity, a string that didn't
 * parse) lands on the default rather than collapsing the layout.
 */
export function clampTextScale(scale: number): number {
  if (!Number.isFinite(scale)) return TEXT_SCALE_DEFAULT;
  if (scale < TEXT_SCALE_MIN) return TEXT_SCALE_MIN;
  if (scale > TEXT_SCALE_MAX) return TEXT_SCALE_MAX;
  return scale;
}

/* --------------------------------- haptics -------------------------------- */

/** How the app has always behaved: the tick is on until someone turns it off. */
export const HAPTICS_DEFAULT = true;

/* -------------------------------- storage -------------------------------- */

const MODE_KEY = "hearth.display.mode";
const HEARTH_KEY = "hearth.display.hearth";
const SCALE_KEY = "hearth.display.textScale";
const HAPTICS_KEY = "hearth.display.haptics";

function parseMode(raw: string | null): DisplayMode {
  return raw === "light" || raw === "dark" || raw === "system"
    ? raw
    : "system";
}

/* A missing key, a scheme from a build that no longer ships it, anything
   unrecognised: all land back on Ember rather than crashing the paint. */
function parseHearth(raw: string | null): HearthId {
  return isHearthId(raw) ? raw : HEARTH_DEFAULT;
}

function parseTextScale(raw: string | null): number {
  if (raw === null) return TEXT_SCALE_DEFAULT;
  return clampTextScale(Number.parseFloat(raw));
}

/* Stored as "on" / "off" rather than "true" / "false" so a storage dump
   reads like the setting does. Only an explicit "off" turns it off.
   A missing key, a half-written value, anything unrecognised, all land on
   the default rather than silently taking the tick away. */
function parseHaptics(raw: string | null): boolean {
  return raw === "off" ? false : HAPTICS_DEFAULT;
}

/* -------------------------------- context -------------------------------- */

const DisplayContext = createContext<DisplayState | null>(null);

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function DisplayProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme() === "dark" ? "dark" : "light";

  const [mode, setModeState] = useState<DisplayMode>("system");
  const [hearth, setHearthState] = useState<HearthId>(HEARTH_DEFAULT);
  const [textScale, setTextScaleState] = useState<number>(TEXT_SCALE_DEFAULT);
  const [haptics, setHapticsState] = useState<boolean>(HAPTICS_DEFAULT);
  const [ready, setReady] = useState(false);

  // A setter that fires before the disk read lands must win. Otherwise the
  // stored value would clobber a choice the student just made.
  const touched = useRef(false);

  useEffect(() => {
    let alive = true;
    void AsyncStorage.getMany([MODE_KEY, HEARTH_KEY, SCALE_KEY, HAPTICS_KEY])
      .then((stored) => {
        if (!alive || touched.current) return;
        setModeState(parseMode(stored[MODE_KEY] ?? null));
        setHearthState(parseHearth(stored[HEARTH_KEY] ?? null));
        setTextScaleState(parseTextScale(stored[SCALE_KEY] ?? null));
        const wantsHaptics = parseHaptics(stored[HAPTICS_KEY] ?? null);
        setHapticsState(wantsHaptics);
        // The taps live outside React, so state alone would leave them on.
        setHapticsEnabled(wantsHaptics);
      })
      .catch(() => {
        // Unreadable storage is not worth a warning in the student's face.
        // System appearance, default type size and the tick left on are a
        // fine place to be.
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setMode = useCallback((next: DisplayMode) => {
    touched.current = true;
    setModeState(next);
    void AsyncStorage.setItem(MODE_KEY, next).catch(() => {
      // The choice still applies for this run; it just won't survive a relaunch.
    });
  }, []);

  const setHearth = useCallback((next: HearthId) => {
    touched.current = true;
    setHearthState(next);
    void AsyncStorage.setItem(HEARTH_KEY, next).catch(() => {
      // The choice still applies for this run; it just won't survive a relaunch.
    });
  }, []);

  const setTextScale = useCallback((next: number) => {
    const safe = clampTextScale(next);
    touched.current = true;
    setTextScaleState(safe);
    void AsyncStorage.setItem(SCALE_KEY, String(safe)).catch(() => {
      // Same deal: applied now, not persisted.
    });
  }, []);

  const setHaptics = useCallback((next: boolean) => {
    touched.current = true;
    setHapticsState(next);
    // Write-through, before the render that follows. A caller that flips the
    // switch on and ticks once to show what it bought needs the new value to
    // be live on the very next line. An effect keyed on state would land
    // after that tick had already been swallowed.
    setHapticsEnabled(next);
    void AsyncStorage.setItem(HAPTICS_KEY, next ? "on" : "off").catch(() => {
      // Same deal as the other two: it holds for this run, not the next one.
    });
  }, []);

  const value = useMemo<DisplayState>(
    () => ({
      mode,
      setMode,
      hearth,
      setHearth,
      textScale,
      setTextScale,
      haptics,
      setHaptics,
      resolvedScheme: mode === "system" ? systemScheme : mode,
      ready,
    }),
    [
      mode,
      setMode,
      hearth,
      setHearth,
      textScale,
      setTextScale,
      haptics,
      setHaptics,
      systemScheme,
      ready,
    ]
  );

  return (
    <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>
  );
}

/**
 * Read the display preferences.
 *
 * Rendering outside `<DisplayProvider>` is a bug, but it must never be a
 * crash or a wrong-appearance flash: the fallback follows the device scheme
 * at the default type size with the tick on, reports `ready: false`, and
 * drops writes with a dev-only warning.
 */
export function useDisplay(): DisplayState {
  const ctx = useContext(DisplayContext);
  const systemScheme = useColorScheme() === "dark" ? "dark" : "light";

  const fallback = useMemo<DisplayState>(() => {
    const dropped = () => {
      if (isDev()) {
        console.warn(
          "[display] a display setter was called outside <DisplayProvider>. The change was dropped."
        );
      }
    };
    return {
      mode: "system",
      setMode: dropped,
      hearth: HEARTH_DEFAULT,
      setHearth: dropped,
      textScale: TEXT_SCALE_DEFAULT,
      setTextScale: dropped,
      haptics: HAPTICS_DEFAULT,
      setHaptics: dropped,
      resolvedScheme: systemScheme,
      ready: false,
    };
  }, [systemScheme]);

  return ctx ?? fallback;
}

/**
 * Just the appearance in effect, for anything that needs to pick between the
 * light and dark halves of a token set (elevation, status bar, map styles)
 * without pulling in the whole preferences object.
 */
export function useResolvedScheme(): ColorScheme {
  return useDisplay().resolvedScheme;
}
