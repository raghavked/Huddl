/* Fallback tones cycle deterministically per name so a roster reads as a
   crowd rather than a wall of one color. Token palette only. Kept free of JSX
   so the logic is unit-testable under the node vitest environment. */
export const TONES = [
  "bg-brand-soft text-brand-ink",
  "bg-accent-soft text-accent",
  "bg-surface-3 text-foreground",
] as const;

export function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return TONES[Math.abs(hash) % TONES.length];
}
