import { cn } from "@/lib/utils";

/** Huddl mark: four rounded "students" leaning into a huddle, on the brand
 *  gradient. Uses a unique gradient id so multiple marks can render safely. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="Huddl"
      className={cn("size-8", className)}
    >
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <g fill="#ffffff">
        <circle cx="16" cy="9.5" r="3.2" />
        <circle cx="8.5" cy="14.5" r="2.6" opacity="0.85" />
        <circle cx="23.5" cy="14.5" r="2.6" opacity="0.85" />
        <path d="M16 14c-4.4 0-7.4 2.8-7.4 7.1 0 1.9 1.4 3.1 3.4 3.1h8c2 0 3.4-1.2 3.4-3.1C23.4 16.8 20.4 14 16 14z" />
      </g>
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark className="size-8" />
      <span className="text-xl font-extrabold tracking-tight">
        huddl
      </span>
    </span>
  );
}
