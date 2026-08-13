import { cn } from "@/lib/utils";

/**
 * The Huddl mark: three heads leaning together inside a speech bubble.
 *
 * The bubble is the category: this is a place where people talk, and an
 * icon on a home screen has about a tenth of a second to say so. The three
 * heads inside are the huddle: the middle one sits a little larger and a
 * little higher, the way the person leaning furthest in always does.
 *
 * They are cut out of the bubble rather than drawn on top of it, so the
 * whole mark is one path in one color. That is what lets it sit on an ember
 * tile, in a cream nav bar, and in a monochrome Android notification tray
 * without a second artwork existing anywhere.
 *
 * The three radii are deliberately unequal (2.75 / 3.15 / 2.9). Perfectly
 * matched circles read as a diagram; the small differences are what make it
 * read as people, and they match the hand-drawn imperfection the
 * illustrations are built on.
 *
 * Two arrangements were rejected on the way here and are worth not
 * re-discovering: heads evenly spaced around a closed ring always resolve
 * into a flower (five petals, or a four-leaf clover at n=4), and two heads
 * above one below reads as a face (two eyes and an open mouth) at any size
 * above about 40px.
 */
const MARK_PATH =
  "M9 4h14a6 6 0 0 1 6 6v6a6 6 0 0 1-6 6h-8.5l-5.6 5.1c-.9.8-2.2.1-2.2-1V22H9a6 6 0 0 1-6-6v-6a6 6 0 0 1 6-6z " +
  "M7.85 15.6a2.75 2.75 0 1 0 5.5 0a2.75 2.75 0 1 0-5.5 0 " +
  "M12.85 12.6a3.15 3.15 0 1 0 6.3 0a3.15 3.15 0 1 0-6.3 0 " +
  "M18.5 15.3a2.9 2.9 0 1 0 5.8 0a2.9 2.9 0 1 0-5.8 0";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="Huddl"
      className={cn("size-8", className)}
    >
      {/* evenodd is what makes the heads holes rather than a second shape. */}
      <path d={MARK_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/** The mark on a solid ember tile: app icon energy, no gradient. */
export function LogoTile({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-10 items-center justify-center rounded-xl bg-brand text-brand-fg shadow-soft",
        className
      )}
    >
      <LogoMark className="size-6" />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark className="size-7 text-brand" />
      <span className="font-display text-xl font-bold tracking-tight">
        huddl
      </span>
    </span>
  );
}
