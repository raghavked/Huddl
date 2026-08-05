import { cn } from "@/lib/utils";

const CONTROL =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground " +
  "placeholder:text-muted/70 transition-colors " +
  "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export function controlClasses(className?: string) {
  return cn(CONTROL, className);
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-sm font-semibold", className)}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={controlClasses(className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={controlClasses(cn("min-h-24 resize-y", className))}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={controlClasses(className)} {...props} />;
}

/** Muted helper line under a control. */
export function Hint({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-muted", className)} {...props} />;
}

/** Inline error line — pair with aria-describedby on the control. */
export function FieldError({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      role="alert"
      className={cn("text-xs font-medium text-danger", className)}
      {...props}
    />
  );
}
