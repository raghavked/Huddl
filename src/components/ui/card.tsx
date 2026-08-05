import { cn } from "@/lib/utils";

const PADDING = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6 sm:p-8",
} as const;

/**
 * v2 card: soft elevation instead of flat hairline boxes.
 * `interactive` adds the hover treatment for cards that are links/buttons —
 * pair it with a `<Link>` inside, or spread onto the Link via `cardClasses`.
 */
export function cardClasses(opts?: {
  padding?: keyof typeof PADDING;
  interactive?: boolean;
  className?: string;
}) {
  const { padding = "md", interactive = false, className } = opts ?? {};
  return cn(
    "rounded-card border border-border bg-surface shadow-soft",
    interactive &&
      "transition-all hover:-translate-y-px hover:border-brand/25 hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
    PADDING[padding],
    className
  );
}

export function Card({
  padding = "md",
  interactive = false,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  padding?: keyof typeof PADDING;
  interactive?: boolean;
}) {
  return (
    <div
      className={cardClasses({ padding, interactive, className })}
      {...props}
    />
  );
}
