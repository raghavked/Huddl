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

/**
 * Display preferences — appearance and type size.
 *
 * One provider, mounted at the very top of the tree, owns both. Everything
 * that paints reads the resolved answer from here rather than asking the
 * device directly, so an explicit light/dark choice actually sticks instead
 * of being overruled by the phone's setting.
 *
 * Both values live in AsyncStorage and are read once on mount. `ready` is
 * false until that read finishes; the root layout holds the splash screen up
 * until then so a student who picked the candle-lit dark never gets a flash
 * of cream on launch.
 */

export type DisplayMode = "system" | "light" | "dark";

export type ColorScheme = "light" | "dark";

export type DisplayState = {
  /** What the student chose. "system" defers to the device. */
  mode: DisplayMode;
  setMode: (mode: DisplayMode) => void;
  /** Type size multiplier, always inside [TEXT_SCALE_MIN, TEXT_SCALE_MAX]. */
  textScale: number;
  setTextScale: (scale: number) => void;
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
 * Force any number — including a garbage value read back from storage — into
 * the safe range. Anything unusable (NaN, Infinity, a string that didn't
 * parse) lands on the default rather than collapsing the layout.
 */
export function clampTextScale(scale: number): number {
  if (!Number.isFinite(scale)) return TEXT_SCALE_DEFAULT;
  if (scale < TEXT_SCALE_MIN) return TEXT_SCALE_MIN;
  if (scale > TEXT_SCALE_MAX) return TEXT_SCALE_MAX;
  return scale;
}

/* -------------------------------- storage -------------------------------- */

const MODE_KEY = "huddl.display.mode";
const SCALE_KEY = "huddl.display.textScale";

function parseMode(raw: string | null): DisplayMode {
  return raw === "light" || raw === "dark" || raw === "system"
    ? raw
    : "system";
}

function parseTextScale(raw: string | null): number {
  if (raw === null) return TEXT_SCALE_DEFAULT;
  return clampTextScale(Number.parseFloat(raw));
}

/* -------------------------------- context -------------------------------- */

const DisplayContext = createContext<DisplayState | null>(null);

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function DisplayProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme() === "dark" ? "dark" : "light";

  const [mode, setModeState] = useState<DisplayMode>("system");
  const [textScale, setTextScaleState] = useState<number>(TEXT_SCALE_DEFAULT);
  const [ready, setReady] = useState(false);

  // A setter that fires before the disk read lands must win — otherwise the
  // stored value would clobber a choice the student just made.
  const touched = useRef(false);

  useEffect(() => {
    let alive = true;
    void AsyncStorage.getMany([MODE_KEY, SCALE_KEY])
      .then((stored) => {
        if (!alive || touched.current) return;
        setModeState(parseMode(stored[MODE_KEY] ?? null));
        setTextScaleState(parseTextScale(stored[SCALE_KEY] ?? null));
      })
      .catch(() => {
        // Unreadable storage is not worth a warning in the student's face —
        // system appearance and default type size are a fine place to be.
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

  const setTextScale = useCallback((next: number) => {
    const safe = clampTextScale(next);
    touched.current = true;
    setTextScaleState(safe);
    void AsyncStorage.setItem(SCALE_KEY, String(safe)).catch(() => {
      // Same deal: applied now, not persisted.
    });
  }, []);

  const value = useMemo<DisplayState>(
    () => ({
      mode,
      setMode,
      textScale,
      setTextScale,
      resolvedScheme: mode === "system" ? systemScheme : mode,
      ready,
    }),
    [mode, setMode, textScale, setTextScale, systemScheme, ready]
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
 * at the default type size, reports `ready: false`, and drops writes with a
 * dev-only warning.
 */
export function useDisplay(): DisplayState {
  const ctx = useContext(DisplayContext);
  const systemScheme = useColorScheme() === "dark" ? "dark" : "light";

  const fallback = useMemo<DisplayState>(() => {
    const dropped = () => {
      if (isDev()) {
        console.warn(
          "[display] setMode/setTextScale called outside <DisplayProvider> — the change was dropped."
        );
      }
    };
    return {
      mode: "system",
      setMode: dropped,
      textScale: TEXT_SCALE_DEFAULT,
      setTextScale: dropped,
      resolvedScheme: systemScheme,
      ready: false,
    };
  }, [systemScheme]);

  return ctx ?? fallback;
}

/**
 * Just the appearance in effect — for anything that needs to pick between the
 * light and dark halves of a token set (elevation, status bar, map styles)
 * without pulling in the whole preferences object.
 */
export function useResolvedScheme(): ColorScheme {
  return useDisplay().resolvedScheme;
}
