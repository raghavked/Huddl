import Image from "next/image";
import { cn, initials } from "@/lib/utils";

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-lg",
  xl: "size-24 text-3xl",
} as const;

const PX = { xs: 24, sm: 32, md: 40, lg: 56, xl: 96 } as const;

/* Fallback tones cycle deterministically per name so a roster reads as a
   crowd, not a wall of one color — token palette only. */
const TONES = [
  "bg-brand-soft text-brand-strong",
  "bg-accent-soft text-accent",
  "bg-surface-3 text-foreground",
] as const;

function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return TONES[Math.abs(hash) % TONES.length];
}

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (src) {
    return (
      <Image
        src={src}
        alt={name}
        width={PX[size]}
        height={PX[size]}
        className={cn(
          "shrink-0 rounded-full object-cover",
          SIZES[size],
          className
        )}
        unoptimized
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        toneFor(name),
        SIZES[size],
        className
      )}
    >
      {initials(name)}
    </span>
  );
}
