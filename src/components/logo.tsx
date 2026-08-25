import { cn } from "@/lib/utils";

/**
 * The Hearth mark: the ember bubble. A speech bubble with a flame burning
 * inside it, and a lit core inside the flame.
 *
 * The bubble is the category: this is a place where people talk, and an
 * icon on a home screen has about a tenth of a second to say so. The flame
 * inside is the name: the fire people actually gather around. The chosen
 * direction (03 on the brand canvas) kept the bubble's exact silhouette
 * from the earlier mark and traded the three heads for one flame.
 *
 * All three shapes live in one even-odd path in one color, which is what
 * makes the chosen colorway need no second artwork: filled white on the
 * ember tile, the bubble renders white, the flame becomes a window showing
 * the ember through it, and the core comes back white. The same path
 * filled ember on cream gives the inverse, and it survives a monochrome
 * Android notification tray untouched.
 */
const MARK_PATH =
  "M9 4h14a6 6 0 0 1 6 6v6a6 6 0 0 1-6 6h-8.5l-5.6 5.1c-.9.8-2.2.1-2.2-1V22H9a6 6 0 0 1-6-6v-6a6 6 0 0 1 6-6z " +
  "M16 8c2.8 2.2 4.9 4.7 4.9 7.4a4.9 4.9 0 0 1-9.8 0C11.1 12.7 13.2 10.2 16 8z " +
  "M16 12.6c1.3 1.2 2.3 2.4 2.3 3.7a2.3 2.3 0 0 1-4.6 0c0-1.3 1-2.5 2.3-3.7z";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="Hearth"
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
        hearth
      </span>
    </span>
  );
}
