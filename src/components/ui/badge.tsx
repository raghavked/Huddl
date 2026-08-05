import { cn } from "@/lib/utils";

export type BadgeTone =
  | "brand"
  | "accent"
  | "neutral"
  | "success"
  | "warning"
  | "danger";

const TONES: Record<BadgeTone, string> = {
  brand: "bg-brand-soft text-brand-ink",
  accent: "bg-accent-soft text-accent",
  neutral: "bg-surface-2 text-muted",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
};

const SOLID: Record<BadgeTone, string> = {
  brand: "bg-brand text-brand-fg",
  accent: "bg-accent text-on-solid",
  neutral: "bg-surface-3 text-foreground",
  success: "bg-success text-on-solid",
  warning: "bg-warning text-on-solid",
  danger: "bg-danger text-on-solid",
};

export function Badge({
  tone = "neutral",
  solid = false,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  solid?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        solid ? SOLID[tone] : TONES[tone],
        className
      )}
      {...props}
    />
  );
}
