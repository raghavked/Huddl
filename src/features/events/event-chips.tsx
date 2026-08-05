import { BookOpen, PartyPopper } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { EventKind } from "@/lib/types";

/** Weekday-over-day date tile — accent, per the calendar-row convention. */
export function DateTile({
  iso,
  size = "sm",
  className,
}: {
  iso: string;
  size?: "sm" | "lg";
  className?: string;
}) {
  const d = new Date(iso);
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 flex-col items-center justify-center rounded-xl bg-accent-soft text-accent",
        size === "lg" ? "size-16" : "size-12",
        className
      )}
    >
      <span className="text-[10px] font-bold uppercase leading-none tracking-wide">
        {d.toLocaleDateString([], { weekday: "short" })}
      </span>
      <span
        className={cn(
          "mt-0.5 font-bold leading-none",
          size === "lg" ? "text-2xl" : "text-lg"
        )}
      >
        {d.getDate()}
      </span>
      {size === "lg" ? (
        <span className="mt-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide">
          {d.toLocaleDateString([], { month: "short" })}
        </span>
      ) : null}
    </span>
  );
}

export function KindBadge({ kind }: { kind: EventKind }) {
  const isStudy = kind === "study_session";
  const Icon = isStudy ? BookOpen : PartyPopper;
  return (
    <Badge tone={isStudy ? "accent" : "brand"}>
      <Icon className="size-3.5" aria-hidden />
      {isStudy ? "Study session" : "Meetup"}
    </Badge>
  );
}
