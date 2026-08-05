import { cn } from "@/lib/utils";

/** Huddl mark: four rounded "students" leaning into a huddle. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="Huddl"
      className={cn("size-8", className)}
    >
      <g fill="currentColor">
        <circle cx="16" cy="7.5" r="4.1" />
        <circle cx="7" cy="14.5" r="3.4" opacity="0.75" />
        <circle cx="25" cy="14.5" r="3.4" opacity="0.75" />
        <path d="M16 13.5c-5.6 0-9.5 3.6-9.5 9.2 0 2.6 1.9 4.3 4.6 4.3h9.8c2.7 0 4.6-1.7 4.6-4.3 0-5.6-3.9-9.2-9.5-9.2z" />
      </g>
    </svg>
  );
}

/** The mark on a violet→raspberry gradient tile — app icon energy. */
export function LogoTile({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-10 items-center justify-center rounded-xl bg-gradient-brand text-brand-fg shadow-soft",
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
