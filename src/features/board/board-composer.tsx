"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus } from "lucide-react";
import {
  Button,
  Card,
  FieldError,
  Hint,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import {
  BOARD_BODY_MAX,
  BOARD_TITLE_MAX,
  BOARD_TITLE_MIN,
  BoardError,
  CATEGORIES,
  categoryInfo,
  createPost,
  parseBoardDay,
  priceCentsFrom,
  priceLabel,
  toBoardDay,
  updatePost,
  type BoardCategory,
  type BoardPost,
} from "@/lib/board";
import { cn } from "@/lib/utils";

/* Putting something on the board, and, with a post to seed it, editing one.
 *
 * One component for both because `updatePost` takes the same whole-composer
 * shape `createPost` does: an edit is a re-save, not a patch, so a post that
 * stops being for sale can't keep a price nobody meant to leave on it. The
 * two paths differ in three places: where the fields start, what the button
 * says, and where you land afterwards.
 *
 * The category comes first and the rest of the form follows it. Every
 * category takes a title and details; `wantsPrice` and `wantsDate` from
 * `@/lib/board` decide whether the price and the leaving-day fields are
 * offered at all, and a field that isn't offered isn't sent. Switch a post
 * from "for sale" to "lost" and the price goes with it.
 *
 * Nothing here re-derives the board's vocabulary: the chips, the icons, and
 * the question in the details placeholder all come from `CATEGORIES`. */

/** Start warning about the details cap this late. Earlier is just nagging. */
const COUNT_VISIBLE_FROM = 1300;

/** What the details field asks before a category has been chosen. */
const NEUTRAL_PLACEHOLDER = "What should people know?";

/** How many days a month has, the calendar screens' own day check. */
function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Dollars in the field, cents in the column. `priceLabel` is the one place
 * that division happens, and it prints "Free" at zero, which is not something
 * you can type back in, so zero seeds as "0".
 */
function seedPrice(cents: number | null): string {
  if (cents === null) return "";
  if (cents === 0) return "0";
  return priceLabel(cents)?.replace(/[$,]/g, "") ?? "";
}

/**
 * Round-trip the stored day through the matched pair rather than trusting the
 * string: anything that isn't a real calendar day comes back as a blank field.
 */
function seedDay(happensOn: string | null): string {
  const parsed = parseBoardDay(happensOn);
  return parsed ? toBoardDay(parsed) : "";
}

export function BoardComposer({
  post,
  initialCategory,
}: {
  /** The post being edited, or null when this is a new one. */
  post: BoardPost | null;
  /** Which board the composer opens on, from `?category=`. */
  initialCategory: BoardCategory | null;
}) {
  const router = useRouter();
  const uid = useId();
  const editing = post !== null;

  const [category, setCategory] = useState<BoardCategory | null>(
    post?.category ?? initialCategory
  );
  const [title, setTitle] = useState(post?.title ?? "");
  const [body, setBody] = useState(post?.body ?? "");
  const [price, setPrice] = useState(() => seedPrice(post?.price_cents ?? null));
  const [day, setDay] = useState(() => seedDay(post?.happens_on ?? null));

  const [priceError, setPriceError] = useState<string | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const info = category !== null ? categoryInfo(category) : null;

  function pickCategory(next: BoardCategory) {
    setCategory(next);
    setFormError(null);
    // A field that's no longer on screen shouldn't keep an error under it.
    setPriceError(null);
    setDayError(null);
  }

  async function handleSave() {
    if (pending || category === null || info === null) return;
    setFormError(null);
    setPriceError(null);
    setDayError(null);

    /* The leaving day, checked exactly the way the calendar pages check a
       date, so the whole app rejects "2026-02-31" with the same sentence. */
    let happensOn: Date | null = null;
    if (info.wantsDate && day.trim().length > 0) {
      const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(day.trim());
      if (!match) {
        setDayError("Dates look like YYYY-MM-DD, as in 2026-10-14.");
        return;
      }
      const year = Number(match[1]);
      const month = Number(match[2]);
      const date = Number(match[3]);
      if (
        month < 1 ||
        month > 12 ||
        date < 1 ||
        date > daysInMonth(month, year)
      ) {
        setDayError("That day doesn't exist. Double-check the month and day.");
        return;
      }
      happensOn = new Date(year, month - 1, date);
    }

    /* Cents, built by the library rather than by multiplying a float here. */
    let priceCents: number | null = null;
    if (info.wantsPrice) {
      try {
        priceCents = priceCentsFrom(price);
      } catch (caught) {
        setPriceError(
          caught instanceof BoardError
            ? caught.message
            : "Write the price as a number: 45, or 45.50."
        );
        return;
      }
    }

    setPending(true);
    try {
      // Only what this composer actually offered gets sent: the two optional
      // columns are cleared by omission when the category doesn't want them.
      const input = { category, title, body, priceCents, happensOn };
      if (post !== null) {
        await updatePost(post.id, input);
        router.replace(`/board/${post.id}`);
        router.refresh();
        return;
      }
      const created = await createPost(input);
      // It's on the board, and that's the completion moment.
      router.replace(`/board/${created.id}`);
      router.refresh();
    } catch (caught) {
      setFormError(
        caught instanceof BoardError
          ? caught.message
          : "That didn't post just now. Give it another go."
      );
      setPending(false);
    }
  }

  const remaining = BOARD_BODY_MAX - body.length;
  const canSubmit = category !== null && title.trim().length >= BOARD_TITLE_MIN;

  return (
    <form
      noValidate
      aria-label={editing ? "Edit your post" : "Post to the board"}
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
      className="flex flex-col gap-5"
    >
      <Card className="animate-fade-up">
        <h2 className="text-sm font-semibold">What is it?</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {CATEGORIES.map(({ key, label, icon: Icon }) => {
            const selected = category === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                disabled={pending}
                onClick={() => pickCategory(key)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                  "disabled:pointer-events-none disabled:opacity-60",
                  selected
                    ? "bg-brand text-brand-fg shadow-soft"
                    : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground"
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
        {category === null ? (
          <Hint className="mt-2.5">
            Pick one. It changes what we ask for next.
          </Hint>
        ) : null}
      </Card>

      <Card>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-title`}>Title</Label>
            <Input
              id={`${uid}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Say it in a few words"
              maxLength={BOARD_TITLE_MAX}
              disabled={pending}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-body`}>
              Details <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Textarea
              id={`${uid}-body`}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              /* The question the board asks about this kind of post. The
                 hardest part of posting is knowing which detail helps. */
              placeholder={info?.placeholder ?? NEUTRAL_PLACEHOLDER}
              maxLength={BOARD_BODY_MAX}
              disabled={pending}
              className="min-h-32"
            />
            {body.length > COUNT_VISIBLE_FROM ? (
              remaining > 0 ? (
                <Hint className="text-right">{remaining} characters left</Hint>
              ) : (
                <p className="text-right text-xs font-medium text-danger">
                  That&apos;s the full {BOARD_BODY_MAX} characters. Swap the
                  rest in a message.
                </p>
              )
            ) : null}
          </div>

          {info?.wantsPrice ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-price`}>
                Price <span className="font-normal text-muted">(optional)</span>
              </Label>
              <Input
                id={`${uid}-price`}
                value={price}
                inputMode="decimal"
                maxLength={10}
                placeholder="45"
                disabled={pending}
                onChange={(event) => {
                  setPrice(event.target.value);
                  if (priceError) setPriceError(null);
                }}
                aria-invalid={priceError ? true : undefined}
                aria-describedby={
                  priceError ? `${uid}-price-error` : `${uid}-price-hint`
                }
              />
              {priceError ? (
                <FieldError id={`${uid}-price-error`}>{priceError}</FieldError>
              ) : (
                <Hint id={`${uid}-price-hint`}>
                  {category === "ride"
                    ? "Gas money, if you're asking for any. Leave it blank if you're not."
                    : "Leave it blank if there isn't one, or put 0 to say it's free."}
                </Hint>
              )}
            </div>
          ) : null}

          {info?.wantsDate ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-day`}>
                Day you&apos;re leaving{" "}
                <span className="font-normal text-muted">(optional)</span>
              </Label>
              <Input
                id={`${uid}-day`}
                type="date"
                value={day}
                disabled={pending}
                onChange={(event) => {
                  setDay(event.target.value);
                  if (dayError) setDayError(null);
                }}
                aria-invalid={dayError ? true : undefined}
                aria-describedby={
                  dayError ? `${uid}-day-error` : `${uid}-day-hint`
                }
              />
              {dayError ? (
                <FieldError id={`${uid}-day-error`}>{dayError}</FieldError>
              ) : (
                <Hint id={`${uid}-day-hint`}>
                  Optional, but it&apos;s the first thing anyone looks for.
                </Hint>
              )}
            </div>
          ) : null}
        </div>
      </Card>

      {formError ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={pending || !canSubmit}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : editing ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Plus className="size-4" aria-hidden />
          )}
          {pending
            ? editing
              ? "Saving…"
              : "Posting…"
            : editing
              ? "Save changes"
              : "Put it on the board"}
        </Button>
      </div>
    </form>
  );
}
