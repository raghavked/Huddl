"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
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

function readPref(): ThemePref {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem("huddl-theme");
  return stored === "light" || stored === "dark" ? stored : "system";
}

function applyPref(pref: ThemePref) {
  if (pref === "system") {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem("huddl-theme");
  } else {
    document.documentElement.dataset.theme = pref;
    localStorage.setItem("huddl-theme", pref);
  }
}

/** Three-way light / system / dark switch, persisted in localStorage. */
export function ThemeToggle({ className }: { className?: string }) {
  // Render the neutral "system" state on the server, then sync after mount.
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    setPref(readPref());
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
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
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
    setPref(readPref());
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
      className={cn(
        "flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        className
      )}
    >
      <Icon className="size-4.5" aria-hidden />
    </button>
  );
}
