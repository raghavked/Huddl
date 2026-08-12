import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* The privacy choices a student can actually reach, and the one cache behind
 * them.
 *
 * The standard every preference in here is held to: a control must be
 * honestly enforceable. If nothing in the app or the database can make the
 * sentence under a switch true, the switch does not ship — see the read
 * receipts note below for the one that was taken back out. Two preferences
 * clear that bar today, and they clear it in different places.
 *
 * ## Typing indicators (`profiles.share_typing`, 0033)
 *
 * One boolean, `not null default true`, and RECIPROCAL by design: turning
 * yours off stops your signal going out AND stops everyone else's coming in.
 * A one-sided view of who is composing is a trap, not a feature, so every
 * reader of this hook honours both halves — `use-typing.ts` is the only one,
 * and it does. That is a client-side promise, kept by exactly one file.
 *
 * ## Who can start a DM with you (`profiles.dm_privacy`, 0040)
 *
 * Three values, widest first: `campus` (anyone who can find you — the column
 * default, and what Huddl has always done), `classmates` (only people you
 * share a course with, this term or a past one), `nobody`.
 *
 * This one is not enforced here at all, and that is the point. The refusal
 * lives in `create_dm_thread`, `create_group_thread` and
 * `add_to_group_thread`, which between them are the only way two people can
 * end up in a thread — `dm_threads` and `dm_participants` have no INSERT
 * policy whatsoever. So a stale cache, an old build, or a client that never
 * heard of the column cannot widen anyone's inbox by a single person.
 *
 * It binds only on STARTING a conversation. A thread that already exists
 * keeps working at every value, replies are never governed by it, and nobody
 * is ever removed from a group they are already in. The settings screen says
 * exactly that, because a student reading "nobody" would otherwise reasonably
 * expect a mute.
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
 * Both preferences read as their COLUMN DEFAULT until the row says otherwise
 * — while the query is in flight, after a failed load, and when nobody is
 * signed in. Typing is on, DMs are open to campus: in each case that is also
 * the way the app behaved before the choice existed, so nothing blinks off
 * during a first paint and then back on. It is the safe direction for both,
 * for opposite reasons — the typing default is reciprocal so it costs nobody
 * anything, and the DM default is only a label on a control the database is
 * the one actually enforcing.
 */

/* ------------------------------ shapes ------------------------------ */

/**
 * Who may START a new conversation with you — the three values
 * `profiles.dm_privacy` accepts, and the only three it ever will: the column
 * carries a check constraint, and `dm_privacy_allows` fails closed on
 * anything it doesn't recognise.
 */
export type DmPrivacy = "campus" | "classmates" | "nobody";

/** The order a picker offers them in: widest reach first. */
export const DM_PRIVACY_OPTIONS: readonly DmPrivacy[] = [
  "campus",
  "classmates",
  "nobody",
];

/** The student's privacy choices, in the app's names rather than the column's. */
export type PrivacyPrefs = {
  /** False stops you broadcasting "typing…" — and hides everyone else's. */
  shareTyping: boolean;
  /**
   * Who may open a NEW thread with you, 1:1 or group. Enforced in the three
   * thread-creating RPCs, never on this side — see the header.
   */
  dmPrivacy: DmPrivacy;
};

/** Which preference a setter is aiming at. */
export type PrivacyPrefKey = keyof PrivacyPrefs;

/**
 * A write that didn't land: which preference it was, and a line to put under
 * that control. Named so a screen with two controls can show the message
 * beside the one that actually failed rather than under both.
 */
export type PrivacySaveError = {
  key: PrivacyPrefKey;
  message: string;
};

/** What {@link usePrivacyPrefs} hands a screen. */
export type PrivacyPrefsApi = {
  /** Always safe to read: defaults while loading, and while signed out. */
  prefs: PrivacyPrefs;
  /** True until the first answer lands for the signed-in student. */
  loading: boolean;
  /** Load failure, written for a person — pair it with a "Try again". */
  error: string | null;
  /** The last failed write, written for a person. Clears on the next change. */
  saveError: PrivacySaveError | null;
  /**
   * Change one preference. Optimistic: the control moves immediately, and
   * rolls back with {@link PrivacyPrefsApi.saveError} set if the row
   * disagrees. Resolves true when it stuck — false when it didn't, which
   * includes a newer change to the same control overtaking this one before it
   * was sent.
   */
  setPref: <K extends PrivacyPrefKey>(
    key: K,
    next: PrivacyPrefs[K]
  ) => Promise<boolean>;
  /** Re-read the row — for a pull-to-refresh or a retry button. */
  refresh: () => Promise<void>;
};

/** The column defaults, and the answer anyone gets before the row arrives. */
const DEFAULT_PREFS: PrivacyPrefs = {
  shareTyping: true,
  dmPrivacy: "campus",
};

/** App name → column name. The only place the snake_case leaks. */
const COLUMN: Record<PrivacyPrefKey, string> = {
  shareTyping: "share_typing",
  dmPrivacy: "dm_privacy",
};

const LOAD_ERROR =
  "We couldn't check your privacy settings just now. Nothing changed — check your connection and give it another go.";

/** One per control, because "give it another flip" is wrong for a picker. */
const SAVE_ERROR: Record<PrivacyPrefKey, string> = {
  shareTyping:
    "That didn't save, so the switch is still the way it was. Give it another flip.",
  dmPrivacy:
    "That didn't save, so you're still on the option that was already set. Give it another tap.",
};

/* ------------------------- the module store -------------------------- */

type PrivacyStatus = "idle" | "loading" | "ready" | "error";

type Store = {
  /** Who the cached prefs belong to; null when signed out. */
  userId: string | null;
  prefs: PrivacyPrefs;
  status: PrivacyStatus;
  error: string | null;
  saveError: PrivacySaveError | null;
};

let store: Store = {
  userId: null,
  prefs: DEFAULT_PREFS,
  status: "idle",
  error: null,
  saveError: null,
};

/**
 * What the row is known to hold: the values a load read, advanced only by a
 * write the database accepted. `store.prefs` runs ahead of this while a write
 * is in flight, which is the point — a rollback aims here rather than at
 * whatever the store held a moment earlier, because that may itself have been
 * an optimistic guess from a tap that never reached the row.
 */
let confirmed: PrivacyPrefs = DEFAULT_PREFS;

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

/** The three literals, as a guard — used on the row and on the way in. */
function isDmPrivacy(value: unknown): value is DmPrivacy {
  return value === "campus" || value === "classmates" || value === "nobody";
}

/**
 * Set one key without letting TypeScript widen the rest. The value arrives as
 * the union of everything a preference can hold, so each branch re-checks the
 * shape it wants and leaves the object alone if it isn't that — the switch is
 * here precisely so a third preference can't be set loosely.
 */
function withPref(
  prefs: PrivacyPrefs,
  key: PrivacyPrefKey,
  value: PrivacyPrefs[PrivacyPrefKey]
): PrivacyPrefs {
  switch (key) {
    case "shareTyping":
      return typeof value === "boolean" ? { ...prefs, shareTyping: value } : prefs;
    case "dmPrivacy":
      return isDmPrivacy(value) ? { ...prefs, dmPrivacy: value } : prefs;
  }
}

/**
 * Narrow the profiles row. The client is untyped, so both fields fall back
 * rather than trusting whatever arrived.
 *
 * `share_typing`: anything that isn't a literal `false` — a missing column, a
 * null, a string — reads as sharing. True is the column default and the
 * pre-existing behaviour, so an odd row can't quietly opt a student out of
 * something they never turned off.
 *
 * `dm_privacy`: anything unrecognised reads as 'campus', the column default
 * and the widest of the three. That direction is deliberate. This cache only
 * *labels* the control — the RPCs do the refusing — so falling back wide can
 * never widen anyone's actual reach, while falling back narrow would draw a
 * student a promise of protection their row might not be making.
 */
function prefsFromRow(raw: unknown): PrivacyPrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS;
  const record = raw as Record<string, unknown>;
  const dmPrivacy = record["dm_privacy"];
  return {
    shareTyping: record["share_typing"] !== false,
    dmPrivacy: isDmPrivacy(dmPrivacy) ? dmPrivacy : DEFAULT_PREFS.dmPrivacy,
  };
}

/* ------------------------------ loading ------------------------------ */

let inflight: Promise<void> | null = null;
let inflightFor: string | null = null;

/** Read the row for `userId`, coalescing concurrent callers onto one query. */
function load(userId: string): Promise<void> {
  if (inflight !== null && inflightFor === userId) return inflight;

  // A different student's row is not evidence about this one's.
  if (store.userId !== userId) confirmed = DEFAULT_PREFS;

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
      .select("share_typing, dm_privacy")
      .eq("id", userId)
      .maybeSingle();
    // Signed out, or a different student took over, while we were waiting.
    if (store.userId !== userId) return;
    if (error || data === null || data === undefined) {
      patch({ status: "error", error: LOAD_ERROR });
      return;
    }
    confirmed = prefsFromRow(data);
    patch({ prefs: confirmed, status: "ready", error: null });
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
  confirmed = DEFAULT_PREFS;
  publish({
    userId: null,
    prefs: DEFAULT_PREFS,
    status: "idle",
    error: null,
    saveError: null,
  });
}

/* ------------------------------ writing ------------------------------ */

/* Two taps on the SAME control inside one round trip used to fight each
 * other. Both UPDATEs went out at once, so PostgREST was free to apply them
 * in either order, and the first one to fail rolled its own now-stale idea of
 * "previous" over the second tap's value. Either way the picker could end up
 * ticking a choice the student never made — and, for `dm_privacy`, promising
 * a lockdown the row isn't enforcing. Two things stop that, per key:
 *
 * `generation` is bumped by every tap, so a write can tell whether it is
 * still the student's latest intent for that control. Only the latest one may
 * roll back or raise an error; an overtaken one bows out silently, because
 * the tap that overtook it owns the column now.
 *
 * `queue` chains the requests, so two writes to one column are never in
 * flight together and the row can't be settled by the older of them. The
 * optimistic patch still happens immediately — it's the request that waits,
 * not the switch.
 */
const generation: Record<PrivacyPrefKey, number> = {
  shareTyping: 0,
  dmPrivacy: 0,
};

const queue: Record<PrivacyPrefKey, Promise<unknown>> = {
  shareTyping: Promise.resolve(),
  dmPrivacy: Promise.resolve(),
};

/** Optimistic single-key write; rolls back that key alone on failure. */
async function writePref<K extends PrivacyPrefKey>(
  userId: string,
  key: K,
  next: PrivacyPrefs[K]
): Promise<boolean> {
  const mine = ++generation[key];
  patch({ prefs: withPref(store.prefs, key, next), saveError: null });

  const send = async (): Promise<boolean> => {
    // Overtaken while queued, or signed out: the value we were sent to write
    // is nobody's intent any more, so don't spend a round trip on it.
    if (generation[key] !== mine || store.userId !== userId) return false;

    const { error } = await supabase
      .from("profiles")
      .update({ [COLUMN[key]]: next })
      .eq("id", userId);

    if (error) {
      // Roll back this key only — a change to the other control in the
      // meantime is the student's intent too, and shouldn't be undone by this
      // failure. Aim at the value the row is known to hold, not at whatever
      // was on screen when this write started, so the caption under the
      // control ("you're still on the option that was already set") is true.
      if (store.userId === userId && generation[key] === mine) {
        patch({
          prefs: withPref(store.prefs, key, confirmed[key]),
          saveError: { key, message: SAVE_ERROR[key] },
        });
      }
      return false;
    }

    confirmed = withPref(confirmed, key, next);
    return true;
  };

  // Both arms of `then` run the write: an earlier tap failing is exactly the
  // case this one exists to recover from, so it must not break the chain.
  const settled = queue[key].then(send, send);
  queue[key] = settled.catch(() => false);
  return settled;
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
 * The signed-in student's privacy choices, plus a setter and a refresh.
 * Backed by a module-level cache, so several screens can read it without
 * each firing a query.
 *
 * `prefs` is always readable — every preference holds its column default
 * while the row is in flight and after a failed load, so a surface never
 * flickers a signal off and back on. `loading` is there for a skeleton, not
 * for a guard.
 *
 * ```tsx
 * const { prefs, setPref, saveError } = usePrivacyPrefs();
 * <Switch
 *   value={prefs.shareTyping}
 *   onValueChange={(next) => void setPref("shareTyping", next)}
 * />
 * <Pressable onPress={() => void setPref("dmPrivacy", "classmates")} />
 * ```
 */
export function usePrivacyPrefs(): PrivacyPrefsApi {
  const { state, userId } = usePrivacyStore();

  const setPref = useCallback(
    async <K extends PrivacyPrefKey>(
      key: K,
      next: PrivacyPrefs[K]
    ): Promise<boolean> => {
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
