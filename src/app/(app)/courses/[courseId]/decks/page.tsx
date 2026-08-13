import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import {
  DecksSection,
  type DeckMeta,
  type DeckRow,
} from "@/features/flashcards/decks-section";
import { getCurrentUser } from "@/lib/auth";
import { buildQueue } from "@/lib/srs";
import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/lib/types";

export const metadata: Metadata = { title: "Flashcards" };

type CardLite = { id: string; deck_id: string; position: number };

/**
 * The course's deck shelf: shared flashcard decks with card counts and how
 * many are due for the viewer. Decks are classmate-scoped by RLS; the due
 * math runs through the same SRS queue the study session uses.
 */
export default async function CourseDecksPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const [{ courseId }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: courseRow } = await supabase
    .from("courses")
    .select("id, code, title")
    .eq("id", courseId)
    .maybeSingle();
  const course = courseRow as Pick<Course, "id" | "code" | "title"> | null;
  if (!course) notFound();

  const [{ data: enrollment }, { data: deckRows }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id")
      .eq("course_id", course.id)
      .eq("user_id", user.userId)
      .maybeSingle(),
    supabase
      .from("decks")
      .select("id, title, created_by, created_at")
      .eq("course_id", course.id)
      .order("created_at", { ascending: true }),
  ]);

  // Decks are for classmates, and the course page has the join door.
  if (!enrollment) redirect(`/courses/${course.id}`);

  const decks = (deckRows ?? []) as DeckRow[];

  // Card counts + your due counts, in two flat queries across all decks.
  let cards: CardLite[] = [];
  if (decks.length > 0) {
    const { data: cardRows } = await supabase
      .from("cards")
      .select("id, deck_id, position")
      .in(
        "deck_id",
        decks.map((deck) => deck.id)
      )
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    cards = (cardRows ?? []) as CardLite[];
  }

  const reviews = new Map<string, { dueAt: Date }>();
  if (cards.length > 0) {
    const { data: reviewRows } = await supabase
      .from("card_reviews")
      .select("card_id, due_at")
      .eq("user_id", user.userId)
      .in(
        "card_id",
        cards.map((card) => card.id)
      );
    for (const row of (reviewRows ?? []) as {
      card_id: string;
      due_at: string;
    }[]) {
      reviews.set(row.card_id, { dueAt: new Date(row.due_at) });
    }
  }

  const byDeck = new Map<string, CardLite[]>();
  for (const card of cards) {
    const bucket = byDeck.get(card.deck_id);
    if (bucket) bucket.push(card);
    else byDeck.set(card.deck_id, [card]);
  }
  const now = new Date();
  const meta: Record<string, DeckMeta> = {};
  for (const deck of decks) {
    const deckCards = byDeck.get(deck.id) ?? [];
    meta[deck.id] = {
      total: deckCards.length,
      // Full due-for-you count: new cards + due reviews, uncapped.
      due: buildQueue(deckCards, reviews, now, deckCards.length).length,
    };
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref={`/courses/${course.id}`}
        backLabel={course.code}
        title={`${course.code} flashcards`}
        description="Shared decks: anyone in the class can add cards. How well you know them stays yours."
      />

      <div className="mt-6">
        <DecksSection
          courseId={course.id}
          userId={user.userId}
          initialDecks={decks}
          initialMeta={meta}
        />
      </div>
    </div>
  );
}
