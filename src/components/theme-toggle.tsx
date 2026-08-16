"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { readThemePref, syncThemeColorMeta } from "@/lib/theme-schemes";
import { cn } from "@/lib/utils";

type ThemePref = "light" | "dark" | "system";

const ORDER: ThemePref[] = ["light", "system", "dark"];

const OPTIONS: {
  value: ThemePref;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: "light", label: "Light theme", icon: Sun },
  { value: "system", label: "Match system theme", icon: Monitor },
  { value: "dark", label: "Dark theme", icon: Moon },
];

/* The storage read, and the browser-chrome sync that has to know the colour
   scheme as well as the theme, both live in @/lib/theme-schemes now: two
   preferences, one meta tag, one owner. */
const readPref = readThemePref;

function applyPref(pref: ThemePref) {
  if (pref === "system") {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem("hearth-theme");
  } else {
    document.documentElement.dataset.theme = pref;
    localStorage.setItem("hearth-theme", pref);
  }
  syncThemeColorMeta();
}

/** Three-way light / system / dark switch, persisted in localStorage. */
export function ThemeToggle({ className }: { className?: string }) {
  // Render the neutral "system" state on the server, then sync after mount.
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    const stored = readPref();
    setPref(stored);
    syncThemeColorMeta();
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-2 p-0.5",
        className
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => {
              setPref(value);
              applyPref(value);
            }}
            /* Drawn at 28px so the switch stays light in the row, tapped at
               44px: the `before` pane reaches 8px past every edge and carries
               the hit area without touching layout. Neighbouring panes meet
               in the blank between chips, never over an icon. */
            className={cn(
              "relative flex size-7 items-center justify-center rounded-full transition-colors before:absolute before:-inset-2 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              active
                ? "bg-surface text-foreground shadow-soft"
                : "text-muted hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/** Compact single-button cycle (light → system → dark) for tight spots. */
export function ThemeToggleCompact({ className }: { className?: string }) {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    const stored = readPref();
    setPref(stored);
    syncThemeColorMeta();
  }, []);

  const current = OPTIONS.find((o) => o.value === pref) ?? OPTIONS[1];
  const Icon = current.icon;

  return (
    <button
      type="button"
      aria-label={`Theme: ${current.label}. Tap to change.`}
      title={current.label}
      onClick={() => {
        const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
        setPref(next);
        applyPref(next);
      }}
      /* Same deal as the three-way switch: 36px of ink, 44px of target. */
      className={cn(
        "relative flex size-9 items-center justify-center rounded-full text-muted transition-colors before:absolute before:-inset-1 before:content-[''] hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        className
      )}
    >
      <Icon className="size-4.5" aria-hidden />
    </button>
  );
}
