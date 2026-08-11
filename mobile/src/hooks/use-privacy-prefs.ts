import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Typing indicators, as the student's own choice.
 *
 * One boolean on `profiles` (migration 0033), `not null default true`, and
 * RECIPROCAL by design: turning yours off stops your signal going out AND
 * stops everyone else's coming in. A one-sided view of who is composing is a
 * trap, not a feature, so every reader of this hook honours both halves —
 * `use-typing.ts` is the only one, and it does.
 *
 * ## Why read receipts are not in here
 *
 * 0033 added `profiles.share_read_receipts` beside `share_typing`, and this
 * hook used to carry both. It shouldn't have: Huddl has no read receipt. No
 * screen anywhere shows one person whether another has opened a message, and
 * the only thing the column could have gated — `channel_members.last_read_at`
 * and `dm_participants.last_read_at` — is the app's own unread cursor, the
 * thing that decides whether YOUR rooms show a dot. Refusing to advance it
 * would not hide a receipt nobody draws; it would light up every room the
 * student had already read, forever, as the price of a privacy switch.
 *
 * So the switch was removed rather than left inert. A toggle that writes a
 * column nothing consults, under a caption promising classmates "stop seeing
 * when you've read a message", is a false statement about a student's own
 * privacy — and it discredits the one beside it that genuinely works.
 *
 * The column stays in the database. The day Huddl actually renders a receipt,
 * the preference comes back here, gated at the surface that draws it — not at
 * the cursor that tracks unread.
 *
 * The answer is cached at module level and shared by every screen that asks:
 * the settings screen and the chat room's typing strip. One query per
 * sign-in, not one per surface. Any write publishes to all of them at once,
 * so the switch on the settings screen and the behaviour in a room can never
 * disagree.
 *
 * The preference reads TRUE until the row says otherwise — while the query is
 * in flight, after a failed load, and when nobody is signed in. That is both
 * the column default and the way the app behaved before the choice existed,
 * so nothing blinks off during a first paint and then back on.
 */

/* ------------------------------ shapes ------------------------------ */

/** The student's sharing choices, in the app's names rather than the column's. */
export type PrivacyPrefs = {
  /** False stops you broadcasting "typing…" — and hides everyone else's. */
  shareTyping: boolean;
};

/** Which preference a setter is aiming at. */
export type PrivacyPrefKey = keyof PrivacyPrefs;

/** What {@link usePrivacyPrefs} hands a screen. */
export type PrivacyPrefsApi = {
  /** Always safe to read: true while loading, and while signed out. */
  prefs: PrivacyPrefs;
  /** True until the first answer lands for the signed-in student. */
  loading: boolean;
  /** Load failure, written for a person — pair it with a "Try again". */
  error: string | null;
  /** The last failed write, written for a person. Clears on the next flip. */
  saveError: string | null;
  /**
   * Flip one preference. Optimistic: the switch moves immediately, and rolls
   * back with {@link PrivacyPrefsApi.saveError} set if the row disagrees.
   * Resolves true when it stuck.
   */
  setPref: (key: PrivacyPrefKey, next: boolean) => Promise<boolean>;
  /** Re-read the row — for a pull-to-refresh or a retry button. */
  refresh: () => Promise<void>;
};

/** The column default, and the answer anyone gets before the row arrives. */
const DEFAULT_PREFS: PrivacyPrefs = {
  shareTyping: true,
};

/** App name → column name. The only place the snake_case leaks. */
const COLUMN: Record<PrivacyPrefKey, string> = {
  shareTyping: "share_typing",
};

const LOAD_ERROR =
  "We couldn't check your privacy settings just now. Nothing changed — check your connection and give it another go.";

const SAVE_ERROR =
  "That didn't save, so the setting is still the way it was. Give it another flip.";

/* ------------------------- the module store -------------------------- */

type PrivacyStatus = "idle" | "loading" | "ready" | "error";

type Store = {
  /** Who the cached prefs belong to; null when signed out. */
  userId: string | null;
  prefs: PrivacyPrefs;
  status: PrivacyStatus;
  error: string | null;
  saveError: string | null;
};

let store: Store = {
  userId: null,
  prefs: DEFAULT_PREFS,
  status: "idle",
  error: null,
  saveError: null,
};

const listeners = new Set<() => void>();

/** Replace the snapshot and wake every subscribed screen. */
function publish(next: Store): void {
  store = next;
  for (const listener of listeners) listener();
}

function patch(fields: Partial<Store>): void {
  publish({ ...store, ...fields });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable snapshot: the object identity only changes when a field does. */
function snapshot(): Store {
  return store;
}

/** Set one key without letting TypeScript widen the rest. */
function withPref(
  prefs: PrivacyPrefs,
  key: PrivacyPrefKey,
  value: boolean
): PrivacyPrefs {
  // One key today; the switch is here so a second one can't be set loosely.
  switch (key) {
    case "shareTyping":
      return { ...prefs, shareTyping: value };
  }
}

/**
 * Narrow the profiles row. The client is untyped, and anything that isn't a
 * literal `false` — a missing column, a null, a string — reads as sharing:
 * true is the column default and the pre-existing behaviour, so an odd row
 * can't quietly opt a student out of something they never turned off.
 */
function prefsFromRow(raw: unknown): PrivacyPrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS;
  const record = raw as Record<string, unknown>;
  return {
    shareTyping: record["share_typing"] !== false,
  };
}

/* ------------------------------ loading ------------------------------ */

let inflight: Promise<void> | null = null;
let inflightFor: string | null = null;

/** Read the row for `userId`, coalescing concurrent callers onto one query. */
function load(userId: string): Promise<void> {
  if (inflight !== null && inflightFor === userId) return inflight;

  patch({
    userId,
    // A refresh for the same student keeps what's on screen so the switches
    // don't blink; a different student starts from the defaults.
    prefs: store.userId === userId ? store.prefs : DEFAULT_PREFS,
    status: "loading",
    error: null,
  });

  const run = async (): Promise<void> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("share_typing")
      .eq("id", userId)
      .maybeSingle();
    // Signed out, or a different student took over, while we were waiting.
    if (store.userId !== userId) return;
    if (error || data === null || data === undefined) {
      patch({ status: "error", error: LOAD_ERROR });
      return;
    }
    patch({ prefs: prefsFromRow(data), status: "ready", error: null });
  };

  inflightFor = userId;
  inflight = run().finally(() => {
    if (inflightFor === userId) {
      inflight = null;
      inflightFor = null;
    }
  });
  return inflight;
}

/** Load once per signed-in student; a failed load retries on the next mount. */
function ensureLoaded(userId: string): void {
  if (
    store.userId === userId &&
    (store.status === "loading" || store.status === "ready")
  ) {
    return;
  }
  void load(userId);
}

/** Sign-out: forget the cached row rather than lend it to the next account. */
function reset(): void {
  if (store.userId === null && store.status === "idle") return;
  publish({
    userId: null,
    prefs: DEFAULT_PREFS,
    status: "idle",
    error: null,
    saveError: null,
  });
}

/* ------------------------------ writing ------------------------------ */

/** Optimistic single-key write; rolls back that key alone on failure. */
async function writePref(
  userId: string,
  key: PrivacyPrefKey,
  next: boolean
): Promise<boolean> {
  const previous = store.prefs[key];
  patch({ prefs: withPref(store.prefs, key, next), saveError: null });

  const { error } = await supabase
    .from("profiles")
    .update({ [COLUMN[key]]: next })
    .eq("id", userId);

  if (error) {
    // Roll back this key only — a flip of the other switch in the meantime
    // is the student's intent too, and shouldn't be undone by this failure.
    if (store.userId === userId) {
      patch({
        prefs: withPref(store.prefs, key, previous),
        saveError: SAVE_ERROR,
      });
    }
    return false;
  }
  return true;
}

/* ------------------------------- hooks ------------------------------- */

/** Subscribe to the shared store and keep it filled for the current student. */
function usePrivacyStore(): { state: Store; userId: string | null } {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const state = useSyncExternalStore(subscribe, snapshot);

  useEffect(() => {
    if (userId === null) reset();
    else ensureLoaded(userId);
  }, [userId]);

  return { state, userId };
}

/**
 * The signed-in student's sharing choices, plus a setter and a refresh.
 * Backed by a module-level cache, so several screens can read it without
 * each firing a query.
 *
 * `prefs` is always readable — a preference is true while the row is in
 * flight and after a failed load, so a surface never flickers a signal off
 * and back on. `loading` is there for a skeleton, not for a guard.
 *
 * ```tsx
 * const { prefs, setPref, saveError } = usePrivacyPrefs();
 * <Switch
 *   value={prefs.shareTyping}
 *   onValueChange={(next) => void setPref("shareTyping", next)}
 * />
 * ```
 */
export function usePrivacyPrefs(): PrivacyPrefsApi {
  const { state, userId } = usePrivacyStore();

  const setPref = useCallback(
    async (key: PrivacyPrefKey, next: boolean): Promise<boolean> => {
      if (userId === null) return false;
      return writePref(userId, key, next);
    },
    [userId]
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (userId === null) return;
    await load(userId);
  }, [userId]);

  return {
    prefs: state.prefs,
    loading:
      userId !== null && (state.status === "idle" || state.status === "loading"),
    error: state.status === "error" ? state.error : null,
    saveError: state.saveError,
    setPref,
    refresh,
  };
}

/**
 * Does this student share typing indicators? False means BOTH halves are
 * off: don't broadcast, and don't surface anyone else's either.
 *
 * True while the preference is still loading — see the note at the top of
 * this file. Reads the same cached row as {@link usePrivacyPrefs}.
 */
export function useSharesTyping(): boolean {
  return usePrivacyStore().state.prefs.shareTyping;
}
