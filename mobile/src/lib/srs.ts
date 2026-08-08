/* Huddl's spaced-repetition brain, as pure functions.
 *
 * The model is deliberately simpler than full SM-2: three buttons, no ease
 * factor, no fractional intervals to explain. Each card you've seen carries a
 * single streak (consecutive non-"again" reviews) and a due time:
 *
 *   - "again" — resets the streak to 0 and brings the card back in 10
 *     minutes, so it can be re-drilled within the same sitting.
 *   - "good"  — bumps the streak by 1 and schedules 1 / 3 / 7 / 14 / 30 days
 *     out, stepped by how long the streak already was.
 *   - "easy"  — bumps the streak by 2 and jumps straight to the longer
 *     ladder: 3 / 7 / 14 / 30 / 60 days.
 *
 * Both ladders are indexed by the PRE-update streak (capped at the last
 * rung), so a brand-new card graded "good" comes back tomorrow, and a card
 * on a five-review streak rests a month.
 *
 * No I/O, no Supabase, no Date.now(): callers pass `now`, so every result is
 * deterministic and unit-testable. Screens feed rows from cards +
 * card_reviews and write the returned state back themselves.
 */

/** The three study buttons, mirroring card_reviews.last_grade. */
export type Grade = "again" | "good" | "easy";

/** A card's private scheduling state: streak so far + when it's next owed. */
export type ReviewState = { streak: number; dueAt: Date };

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** "Again" brings the card back this soon — same sitting, not same month. */
export const AGAIN_DELAY_MINUTES = 10;

/** Days until the next look after "good", indexed by the pre-update streak. */
export const GOOD_INTERVAL_DAYS: readonly number[] = [1, 3, 7, 14, 30];

/** Days until the next look after "easy" — the same ladder, one rung up. */
export const EASY_INTERVAL_DAYS: readonly number[] = [3, 7, 14, 30, 60];

/** Ladder lookup, clamped to the ends so any streak resolves to a rung. */
function intervalDays(ladder: readonly number[], prevStreak: number): number {
  const index = Math.min(Math.max(prevStreak, 0), ladder.length - 1);
  return ladder[index] ?? ladder[ladder.length - 1] ?? 1;
}

/**
 * The whole scheduler: given a card's previous state (null for a card this
 * student has never graded) and the button they just pressed, return the new
 * streak and due time.
 *
 * @param prev  The existing review row's streak, or null on first contact.
 * @param grade Which of the three buttons was pressed.
 * @param now   The current moment — passed in, never read from the clock.
 */
export function nextReview(
  prev: { streak: number } | null,
  grade: Grade,
  now: Date
): ReviewState {
  const prevStreak = Math.max(prev?.streak ?? 0, 0);
  if (grade === "again") {
    return {
      streak: 0,
      dueAt: new Date(now.getTime() + AGAIN_DELAY_MINUTES * MINUTE_MS),
    };
  }
  const ladder = grade === "good" ? GOOD_INTERVAL_DAYS : EASY_INTERVAL_DAYS;
  return {
    streak: prevStreak + (grade === "good" ? 1 : 2),
    dueAt: new Date(now.getTime() + intervalDays(ladder, prevStreak) * DAY_MS),
  };
}

/**
 * Assemble a study queue from a deck's cards and this student's review rows:
 *
 *   1. NEW cards (no review row yet) first, in deck position order — ties
 *      keep the caller's order, so pass cards as fetched (position, then
 *      created_at).
 *   2. Then DUE cards (due_at <= now), oldest-due first.
 *
 * Cards with a review row that isn't due yet stay out entirely. The result
 * is capped (default 30) so a monster deck stays a sit-downable session —
 * pass `cards.length` as the cap to get the full due set (handy for "4 due
 * for you" counts).
 *
 * @param cards   The deck's cards, in (position, created_at) order.
 * @param reviews This student's review state, keyed by card id.
 * @param now     The current moment — passed in, never read from the clock.
 * @param cap     Maximum queue length; non-positive means an empty queue.
 */
export function buildQueue<C extends { id: string; position: number }>(
  cards: readonly C[],
  reviews: ReadonlyMap<string, { dueAt: Date }>,
  now: Date,
  cap = 30
): C[] {
  const fresh = cards
    .filter((card) => !reviews.has(card.id))
    .sort((a, b) => a.position - b.position);

  const dueTime = (card: C): number =>
    reviews.get(card.id)?.dueAt.getTime() ?? Number.POSITIVE_INFINITY;

  const due = cards
    .filter((card) => {
      const review = reviews.get(card.id);
      return review !== undefined && review.dueAt.getTime() <= now.getTime();
    })
    .sort((a, b) => dueTime(a) - dueTime(b));

  return [...fresh, ...due].slice(0, Math.max(cap, 0));
}
