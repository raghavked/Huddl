"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Type } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, Card, PageHeader, SectionHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

/* Appearance: the theme and the type size, kept on this device.
 *
 * Two preferences, two mechanisms, and they deliberately stay separate:
 *
 *   THEME is already solved. `@/components/theme-toggle` owns the
 *   "hearth-theme" key, stamps `data-theme` on the document root, and keeps
 *   the browser-chrome color in step; the boot script in the root layout
 *   replays it before first paint so nobody sees a flash of cream. This page
 *   reuses that control rather than growing a second one that could drift out
 *   of sync with it.
 *
 *   TYPE SIZE is this page's own. The scale is stored under
 *   "hearth-text-size" and applied by stamping `--hearth-text-scale` and a
 *   percentage `font-size` on the document root. Every size in the app is a
 *   rem, so moving the root moves the whole app together (text, the rows it
 *   sits in, and the 44px targets around it) instead of leaving big type
 *   crammed into small rows.
 *
 * Both are per-device on purpose: the phone in a lecture hall and the laptop
 * at the library table are allowed to want different things, and neither
 * belongs in a profile row on a server.
 */

/* ------------------------------- text size ------------------------------- */

/** Where the preference lives. Read by this page and applied to the root. */
const SCALE_KEY = "hearth-text-size";

/** Below this, captions stop being legible. */
const SCALE_MIN = 0.9;
/** Above this, two-line rows and the dock start to break. */
const SCALE_MAX = 1.4;
/** The default: the sizes the design was drawn at. */
const SCALE_DEFAULT = 1;

/** The rungs of the ladder, with the warm name for each. */
const STEPS: readonly { scale: number; name: string }[] = [
  { scale: 0.9, name: "Compact" },
  { scale: 1, name: "Default" },
  { scale: 1.15, name: "Roomy" },
  { scale: 1.3, name: "Large" },
  { scale: 1.4, name: "Largest" },
];

/** Floats read back from storage never land exactly, so compare with slack. */
function sameScale(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

/**
 * Force any number, including a garbled value read back from storage, into
 * the safe range. Anything unusable lands on the default rather than
 * collapsing the layout.
 */
function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return SCALE_DEFAULT;
  return Math.min(Math.max(scale, SCALE_MIN), SCALE_MAX);
}

/** The stored scale, or the default when there isn't one. */
function readScale(): number {
  if (typeof window === "undefined") return SCALE_DEFAULT;
  try {
    const stored = localStorage.getItem(SCALE_KEY);
    return stored === null ? SCALE_DEFAULT : clampScale(Number.parseFloat(stored));
  } catch {
    // A locked-down browser is not worth an error in someone's face.
    return SCALE_DEFAULT;
  }
}

/**
 * Stamp the scale on the document root and remember it. At the default the
 * inline size is removed outright, so the browser's own font-size setting
 * (somebody else's accessibility preference) takes back over.
 */
function applyScale(scale: number) {
  const root = document.documentElement;
  root.style.setProperty("--hearth-text-scale", String(scale));
  if (sameScale(scale, SCALE_DEFAULT)) {
    root.style.removeProperty("font-size");
  } else {
    root.style.fontSize = `${Math.round(scale * 100)}%`;
  }
  try {
    if (sameScale(scale, SCALE_DEFAULT)) localStorage.removeItem(SCALE_KEY);
    else localStorage.setItem(SCALE_KEY, String(scale));
  } catch {
    // It applies for this session; it just won't survive a reload.
  }
}

/** The name for whatever scale is in effect, for the caption under the ladder. */
function nameForScale(scale: number): string {
  return STEPS.find((step) => sameScale(step.scale, scale))?.name ?? "Custom";
}

/* --------------------------------- page ---------------------------------- */

export default function AppearanceSettingsPage() {
  // Render the neutral default on the server, then sync after mount.
  const [scale, setScale] = useState(SCALE_DEFAULT);

  useEffect(() => {
    const stored = readScale();
    setScale(stored);
    applyScale(stored);
  }, []);

  function chooseScale(next: number) {
    const safe = clampScale(next);
    setScale(safe);
    applyScale(safe);
  }

  const isDefault = sameScale(scale, SCALE_DEFAULT);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/settings"
        backLabel="Settings"
        title="Appearance"
        description="How Hearth looks on this device: the theme and the size of the type."
      />

      <section aria-label="Theme" className="mt-8">
        <SectionHeader title="Theme" />
        <Card className="mt-3 animate-fade-up">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-bold tracking-tight">Light, dark, or system</p>
              <p className="mt-1 text-sm text-muted text-pretty">
                System follows whatever your device is doing. Light is the warm
                cream one; dark is the candle-lit one, made for a late library
                table.
              </p>
            </div>
            <ThemeToggle className="shrink-0" />
          </div>
        </Card>
      </section>

      <section aria-label="Text size" className="mt-8">
        <SectionHeader title="Text size" />

        <div
          role="radiogroup"
          aria-label="Text size"
          className="mt-3 flex items-center gap-1 rounded-full border border-border bg-surface-2 p-1"
        >
          {STEPS.map((step) => {
            const selected = sameScale(scale, step.scale);
            return (
              <button
                key={step.scale}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${step.name} text size`}
                title={step.name}
                onClick={() => chooseScale(step.scale)}
                className={cn(
                  "flex h-11 flex-1 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                  selected
                    ? "border-brand bg-brand-soft text-brand-ink"
                    : "border-transparent text-muted hover:text-foreground"
                )}
              >
                {/* Drawn at its own step, in px, so the five stay a ladder
                    you can read at a glance whatever the current setting is. */}
                <span
                  aria-hidden
                  className="font-display font-bold leading-none"
                  style={{ fontSize: `${Math.round(16 * step.scale)}px` }}
                >
                  A
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex min-h-9 items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <Type className="size-3.5" aria-hidden />
            {nameForScale(scale)}
          </p>
          {isDefault ? null : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => chooseScale(SCALE_DEFAULT)}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Reset to default
            </Button>
          )}
        </div>

        <p className="mt-5 px-1 text-xs text-muted">
          Here&apos;s how a post reads at that size:
        </p>
        <Card className="mt-2">
          {/* A sample rather than a section, so it stays out of the heading outline. */}
          <p className="font-bold tracking-tight">
            Thursday night, Shields third floor
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-pretty">
            I&apos;m camping out with the practice midterm from 7 until they
            kick us out. Bring questions, I&apos;ll bring the coffee and the
            good pens.
          </p>
        </Card>
      </section>

      <p className="mt-8 px-1 text-xs leading-relaxed text-muted text-pretty">
        Both settings are saved in this browser, on this device. Signing in
        somewhere else starts fresh.
      </p>
    </div>
  );
}
