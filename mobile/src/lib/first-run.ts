import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Href } from "expo-router";
import { supabase } from "@/lib/supabase";

/* First run — the data layer.
 *
 * Two unrelated-looking things live here because they answer the same
 * question from two directions: *is this student still new?*
 *
 *   1. The welcome flag. One AsyncStorage key that remembers whether the
 *      one-time welcome has been shown. Every failure in this half degrades
 *      to "already seen" — a phone with unwritable storage must never trap
 *      someone in a tour they can't finish, and a welcome nobody sees is a
 *      far smaller problem than a welcome nobody can dismiss.
 *
 *   2. The starter state. One read of what a new student still lacks —
 *      classes, a channel they picked themselves, a face, a line about
 *      themselves — plus a pure helper that turns that into the ordered
 *      checklist, copy and destinations included. The screen renders; it
 *      does not compose sentences and it does not write five queries.
 *
 * No React in here, no theme, no navigation calls — storage, three cheap
 * queries, and one pure function.
 */

/* ------------------------------ storage ----------------------------- */

/**
 * The one key. Namespaced like `huddl.display.mode` so everything Huddl
 * stores on the device sorts together and nothing else can collide with it.
 *
 * Bump the suffix (not the prefix) if a future welcome should be shown again
 * to students who dismissed the old one — that is a deliberate re-run, and it
 * should look deliberate in the diff.
 */
const WELCOME_KEY = "huddl.firstRun.welcomeSeen";

/** What we write. Presence is the flag; the value is only ever read back as "something is here". */
const WELCOME_VALUE = "1";

/**
 * Whether the one-time welcome has already been shown on this device.
 *
 * Per-device, not per-account: it lives in AsyncStorage, so a student who
 * signs out and back in is not walked through it again, and a new phone
 * starts fresh. That is the right trade for a welcome — it is orienting
 * someone in an app, not recording something about them.
 *
 * **Never throws, and never resolves false on a fault.** Unreadable storage
 * resolves `true`, which means "skip the welcome". A student whose device
 * storage is broken lands straight in the app rather than on a screen whose
 * dismissal can't be recorded.
 *
 * @returns True when the welcome has been seen, or when we couldn't tell.
 */
export async function hasSeenWelcome(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(WELCOME_KEY);
    return raw !== null;
  } catch {
    // Storage is unreadable. "Seen" is the safe direction — see above.
    return true;
  }
}

/**
 * Record that the welcome has been shown. Call it when the student dismisses
 * or finishes it, not when it mounts — a welcome that got closed by a crash
 * is one they should still get.
 *
 * **Never throws.** A failed write costs one extra welcome on the next
 * launch, which is not worth an error in anyone's face. Flip your own state
 * the moment you call this rather than re-reading {@link hasSeenWelcome},
 * so the dismissal is instant and holds for the rest of the session even if
 * the write quietly failed.
 */
export async function markWelcomeSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(WELCOME_KEY, WELCOME_VALUE);
  } catch {
    // Applied for this run; it just won't survive a relaunch.
  }
}

/**
 * Forget that the welcome was ever seen, so the next launch shows it again.
 *
 * For a "show me the welcome again" affordance in settings and for anyone
 * working on the welcome itself. It clears only this key — no profile data,
 * no session, nothing on the server.
 *
 * **Never throws.** If the delete fails the flag stays set and the welcome
 * stays skipped, which is the same safe direction the rest of this half
 * leans in.
 */
export async function resetFirstRun(): Promise<void> {
  try {
    await AsyncStorage.removeItem(WELCOME_KEY);
  } catch {
    // Nothing to tell the student here — the welcome simply won't reappear.
  }
}

/* ------------------------------ shapes ------------------------------ */

/**
 * What a student has actually set up, as four plain values. Everything a
 * "get set up" checklist needs, and nothing it doesn't — no profile row, no
 * course list, no channel list, so a caller can hold it in state cheaply and
 * refetch it on focus without thinking twice.
 *
 * Read it with {@link fetchStarterState}; turn it into a checklist with
 * {@link starterSteps}.
 */
export type StarterState = {
  /**
   * Classes on the student's shelf right now. Archived enrollments (0028's
   * `enrollments.archived_at`) are excluded — a student who shelved last
   * quarter's courses and hasn't added this quarter's genuinely does have an
   * empty shelf, and the checklist should say so.
   */
  courseCount: number;
  /**
   * Campus and topic channels the student *chose*. Deliberately not every
   * membership: course chats arrive with the class, and the four default
   * campus channels are auto-joined at signup, so counting either would mark
   * this step done before the student had done anything.
   */
  joinedChannelCount: number;
  /** Whether `profiles.avatar_url` holds an actual photo URL. */
  hasAvatar: boolean;
  /** Whether `profiles.bio` holds an actual line of text. */
  hasBio: boolean;
};

/** The step identities, stable enough to use as a React key or a log tag. */
export type StarterStepKey = "courses" | "channels" | "photo" | "bio";

/**
 * One line of the "get set up" checklist, ready to render: a title, a warm
 * sentence under it, whether it's done, and where tapping it goes.
 *
 * The copy lives in the data on purpose. Four screens could show this
 * checklist — home, an empty course list, the welcome itself, settings — and
 * they should all say the same four sentences.
 */
export type StarterStep = {
  /** Stable identity. Use it as the list key. */
  key: StarterStepKey;
  /** The row's primary line. Sentence case, an action the student can take. */
  title: string;
  /** One sentence on why it's worth doing. Reads true done or not done. */
  body: string;
  /** True when {@link StarterState} says this is already handled. */
  done: boolean;
  /** Where the row goes. Pass straight to `router.push`. */
  route: Href;
};

/* ----------------------------- failures ----------------------------- */

/**
 * A first-run failure with a message written for a person, not a log. Show
 * `err.message` directly in an inline error — it never leaks SQL, ids, or
 * PostgREST codes.
 */
export class FirstRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirstRunError";
  }
}

/** The one thing that can go wrong reading the starter state. */
const LOAD_FAILED =
  "We couldn't check how your setup is going. Give it another go.";

/* ---------------------------- narrowing ----------------------------- */

/**
 * A PostgREST `count` as a whole number ≥ 0. Null, NaN, or a negative from a
 * partial response all read as 0 rather than poisoning a comparison.
 */
function safeCount(raw: number | null): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return raw > 0 ? Math.trunc(raw) : 0;
}

/**
 * Whether a nullable text column holds something a person actually typed.
 * A whitespace-only bio is a bio nobody wrote, and the checklist should keep
 * asking for it.
 */
function filledIn(raw: unknown): boolean {
  return typeof raw === "string" && raw.trim().length > 0;
}

/** Read one field off a row that PostgREST typed loosely, without casting the row. */
function field(raw: unknown, key: string): unknown {
  if (typeof raw !== "object" || raw === null) return null;
  return (raw as Record<string, unknown>)[key];
}

/**
 * The caller's `profiles.id`, read from the stored session — no network hop,
 * supabase-js refreshes a stale token itself.
 *
 * @throws {FirstRunError} When nobody's signed in.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (error || typeof id !== "string" || id.length === 0) {
    throw new FirstRunError("Sign in again to pick up where you left off.");
  }
  return id;
}

/* ------------------------------- read ------------------------------- */

/**
 * Everything a "get set up" checklist needs, in one call.
 *
 * Three requests go out together and none of them ships a row of data it
 * doesn't need: two head-only `count: "exact"` queries — active enrollments,
 * and channel memberships inner-joined to `channels` so the auto-joined
 * defaults and the course chats are filtered out server-side — plus a
 * two-column read of the caller's own profile. Cheap enough to run on every
 * focus of the home screen.
 *
 * The channel filter is the subtle one. `channels!inner(kind, is_default)`
 * with `kind != 'course'` and `is_default = false` counts only the channels a
 * student went and found: course chats come free with the class, and the four
 * campus defaults are joined by a trigger the moment their profile exists. A
 * plain membership count would report "4" to someone who has done nothing.
 *
 * Throws rather than guessing, because a checklist built from half-read data
 * tells students to do things they've already done. On a screen, pair it with
 * a "Try again" button; in a section of a fuller screen, `.catch(() => null)`
 * and render nothing — a missing nudge is no loss.
 *
 * @returns The four counts and flags. Missing profile row reads as no photo
 *   and no bio, which is exactly right mid-onboarding.
 * @throws {FirstRunError} With copy that's ready to render.
 */
export async function fetchStarterState(): Promise<StarterState> {
  const userId = await requireUserId();

  const [courses, channels, profile] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("archived_at", null),
    supabase
      .from("channel_members")
      .select("channel_id, channels!inner(kind, is_default)", {
        count: "exact",
        head: true,
      })
      .eq("user_id", userId)
      .neq("channels.kind", "course")
      .eq("channels.is_default", false),
    supabase
      .from("profiles")
      .select("avatar_url, bio")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  if (courses.error || channels.error || profile.error) {
    throw new FirstRunError(LOAD_FAILED);
  }

  return {
    courseCount: safeCount(courses.count),
    joinedChannelCount: safeCount(channels.count),
    hasAvatar: filledIn(field(profile.data, "avatar_url")),
    hasBio: filledIn(field(profile.data, "bio")),
  };
}

/* --------------------------- pure helpers --------------------------- */

/**
 * The checklist itself: four steps, always all four, always in this order —
 * classes, then a channel, then a face, then a line about yourself.
 *
 * The order is the argument. Classes are the spine of the app; a student with
 * no courses has an empty calendar, empty notes, and no classmates, so
 * nothing else is worth suggesting first. Channels are next because they're
 * the one step that pays off with people the same evening. The two profile
 * steps come last: they matter for how classmates read you, but they matter
 * only once you're somewhere they'll see you.
 *
 * Completed steps stay in the list rather than disappearing — a checklist you
 * can see yourself finishing is worth more than one that quietly shrinks —
 * and the caller decides whether to strike them through, tuck them under a
 * "done" heading, or hide the whole thing once {@link starterProgress} says
 * everything's handled.
 *
 * Pure: no I/O, no clock, no theme, no navigation. Safe to call in render.
 *
 * @param state From {@link fetchStarterState}. Garbage counts (NaN, negative)
 *   read as not done rather than throwing.
 */
export function starterSteps(state: StarterState): StarterStep[] {
  return [
    {
      key: "courses",
      title: "Add your classes",
      body: "Each one brings its chat, its calendar, and everyone else in the section along with it.",
      done: state.courseCount >= 1,
      route: "/courses/add",
    },
    {
      key: "channels",
      title: "Find a campus channel",
      body: "You're already in the campus-wide ones. Browse the rest and join whatever sounds like your evening.",
      done: state.joinedChannelCount >= 1,
      route: "/channels/browse",
    },
    {
      key: "photo",
      title: "Add a photo",
      body: "It's how classmates place you in a channel full of handles.",
      done: state.hasAvatar,
      route: "/account",
    },
    {
      key: "bio",
      title: "Say a line about yourself",
      body: "Your major, your year, what you're taking — enough that someone in your section knows who they're talking to.",
      done: state.hasBio,
      route: "/account",
    },
  ];
}

/**
 * How far along the checklist is: `{ done, total }`, for the "2 of 4" line
 * above it and for deciding whether to draw the checklist at all.
 *
 * Pure. Counts {@link starterSteps} rather than re-deriving the rules, so the
 * tally can never disagree with the rows underneath it.
 *
 * @param state From {@link fetchStarterState}.
 * @returns Counts where `done` is never above `total`. `done === total` means
 *   the student is set up and the checklist has earned its retirement.
 */
export function starterProgress(state: StarterState): {
  done: number;
  total: number;
} {
  const steps = starterSteps(state);
  return {
    done: steps.filter((step) => step.done).length,
    total: steps.length,
  };
}
