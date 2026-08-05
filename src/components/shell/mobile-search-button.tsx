"use client";

import { Search } from "lucide-react";
import { OPEN_PALETTE_EVENT } from "@/features/search/command-palette";

/** Compact quick-search trigger for the mobile top bar. */
export function MobileSearchButton() {
  return (
    <button
      type="button"
      aria-label="Quick search"
      onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
      className="flex size-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <Search className="size-5" aria-hidden />
    </button>
  );
}
