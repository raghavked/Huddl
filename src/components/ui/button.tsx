import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "soft"
  | "ghost"
  | "danger"
  | "danger-ghost";

export type ButtonSize = "sm" | "md" | "lg" | "icon";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold transition-all select-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand " +
  "disabled:pointer-events-none disabled:opacity-60 active:scale-[0.98]";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-fg shadow-soft hover:bg-brand-strong",
  secondary:
    "border border-border bg-surface shadow-soft hover:bg-surface-2 hover:border-brand/30",
  soft: "bg-brand-soft text-brand-ink hover:bg-brand hover:text-brand-fg",
  ghost: "text-muted hover:bg-surface-2 hover:text-foreground",
  danger: "bg-danger text-on-solid shadow-soft hover:opacity-90",
  "danger-ghost":
    "border border-border bg-surface text-danger hover:bg-danger/10 hover:border-danger/40 focus-visible:outline-danger",
};

/* Every size clears the 44px touch floor — "sm" stays visually secondary
   through tighter padding and smaller type, not a shorter body. */
const SIZES: Record<ButtonSize, string> = {
  sm: "h-11 px-4 text-xs",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-7 text-base",
  icon: "size-11 p-0",
};

/** Class builder — use directly on `<Link>` / `<button>` elements. */
export function buttonClasses(opts?: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const { variant = "primary", size = "md", className } = opts ?? {};
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, className })}
      {...props}
    />
  );
}
