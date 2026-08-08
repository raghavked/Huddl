"use client";

import Image from "next/image";
import { useState } from "react";
import { cn, initials } from "@/lib/utils";
import { toneFor } from "@/components/avatar-tone";

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
  // A broken avatar URL falls back to the initials look. Tracking the URL
  // that failed (not just a boolean) lets a new src get a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && src !== failedSrc) {
    return (
      <Image
        src={src}
        alt={name}
        width={PX[size]}
        height={PX[size]}
        onError={() => setFailedSrc(src)}
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
