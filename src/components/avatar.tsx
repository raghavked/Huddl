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
        "flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand-strong",
        SIZES[size],
        className
      )}
    >
      {initials(name)}
    </span>
  );
}
