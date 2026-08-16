import {
  Award,
  BookOpen,
  Calendar,
  Coffee,
  MapPin,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import { courseTintClasses, type CourseTint } from "@/lib/course-color";
import {
  roomGlyph,
  roomMonogram,
  roomTone,
  roomTitle,
  type RoomKind,
} from "@/lib/room-identity";
import { cn } from "@/lib/utils";

/**
 * The face a room wears in every list, header and picker: a rounded tile
 * that says what KIND of place this is, replacing the hash and speaker
 * glyphs that said "Discord" instead. The native twin lives at
 * mobile/src/components/room-tile.tsx and the split of duties is the same:
 * lib/room-identity.ts decides, this renders.
 *
 * room-identity names glyphs in Feather's vocabulary; this map is the whole
 * translation to lucide, and the test on the shared module counts it.
 */
const GLYPHS: Record<string, LucideIcon> = {
  coffee: Coffee,
  users: Users,
  calendar: Calendar,
  tag: Tag,
  "map-pin": MapPin,
  "book-open": BookOpen,
  award: Award,
};

const SIZES = {
  sm: { tile: "size-8 rounded-lg", icon: "size-4", text: "text-xs" },
  md: { tile: "size-10 rounded-xl", icon: "size-5", text: "text-sm" },
} as const;

export function RoomTile({
  kind,
  name,
  slug,
  tint,
  size = "sm",
  className,
}: {
  kind: RoomKind;
  name: string | null;
  slug: string;
  /** The course's tint, when the caller has the course in hand. */
  tint?: CourseTint;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const glyphName = roomGlyph(kind, slug);
  const Glyph = glyphName ? GLYPHS[glyphName] : null;
  const s = SIZES[size];

  let toneClasses = "bg-brand-soft text-brand";
  if (kind === "course" && tint) {
    const classes = courseTintClasses(tint);
    toneClasses = cn(classes.soft, classes.ink);
  } else if (kind === "club") {
    toneClasses = "bg-accent-soft text-accent";
  } else if (kind === "topic") {
    toneClasses =
      roomTone(roomTitle(name, slug)) === "ember"
        ? "bg-brand-soft text-brand-ink"
        : "bg-accent-soft text-accent";
  }

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        s.tile,
        toneClasses,
        className
      )}
    >
      {Glyph ? (
        <Glyph className={s.icon} />
      ) : (
        <span className={cn("font-bold leading-none", s.text)}>
          {roomMonogram(roomTitle(name, slug))}
        </span>
      )}
    </span>
  );
}
