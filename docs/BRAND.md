# Huddl — Brand Guide

## The name

**Huddl** — a huddle is what a team does before it matters: heads together,
quick, in it together. Dropping the *e* keeps it fast and app-native. The
product turns a campus into a series of huddles — course channels, clubs, study
sessions, DMs.

**Tagline:** *Your campus, in one huddle.*

## Positioning

Huddl is a **student-first, campus-scoped** communication app — the energy of
BeReal and Yik Yak (social, colorful, expressive, gen-Z native) with the
structure of Discord (channels, threads, DMs). It is warm and playful, but it
earns trust: verified campuses, on-device schedule reading, notified access.

## Voice & tone

Warm, plainspoken, a little witty — a helpful classmate, never a corporation.
Short sentences. Confident, not hypey. We say what the product does and what it
won't do.

Example in-app strings:
- "Your campus, in one huddle."
- "Now open at UC Davis — the UC system is next."
- "Course chat that sets itself up from your schedule."
- "Notes that don't die in group chats."
- "We never sell student data and never run ads in course channels."

## The vibrant-playful system

The identity is **gradient-forward**: a signature violet → pink → orange sweep,
big rounded shapes, bold friendly type, generous space. Both light and dark are
first-class; everything is token-driven (see `src/app/globals.css`) so the
palette cascades — never hardcode hex in components.

### Signature gradient

`--grad-from #8b5cf6` (violet) → `--grad-via #ec4899` (pink) → `--grad-to
#fb7a34` (orange). Exposed as utilities:

| Utility | Use |
| --- | --- |
| `bg-brand-gradient` | primary CTAs, active nav, badges, avatar fallbacks, hero |
| `bg-brand-gradient-soft` | section/card background washes |
| `text-gradient` | headline accents (pair with `font-extrabold`) |
| `ring-gradient` | gradient border on a surface fill |
| `shadow-glow` | colored glow under CTAs/cards |
| `animate-float-blob` | drifting decorative blobs (reduced-motion safe) |

### Palette tokens

| Token | Light | Dark |
| --- | --- | --- |
| background | `#fdf7ff` | `#130f1f` |
| foreground | `#1a1330` | `#f3eefb` |
| surface | `#ffffff` | `#1d1630` |
| surface-2 | `#f7eefb` | `#271d3f` |
| border | `#ece0f5` | `#382a55` |
| muted | `#6d6382` | `#a99cc4` |
| brand | `#9d2ee0` | `#c26cf2` |
| brand-strong | `#7d1cc4` | `#b04fe8` |
| brand-soft | `#f6e7fd` | `#2d1c44` |
| accent (pink) | `#ec4899` | `#f472b6` |
| success | `#16a34a` | `#4ade80` |
| danger | `#e11d48` | `#fb7185` |
| warning | `#ea9412` | `#fbbf24` |

### Logo

The mark is four rounded figures leaning into a huddle, on a rounded-square
gradient tile (`src/components/logo.tsx`). Pair with the lowercase `huddl`
wordmark in `font-extrabold`. The mark's gradient uses the same tokens, so it
recolors with the theme. PWA icons live in `public/icons/`.

### Type

Geist (sans). Headings `font-extrabold tracking-tight`, often `text-balance`.
Body in `text-muted` for secondary text. Big and confident.

## Do / don't

- **Do** use the gradient for the moments that matter (primary CTA, active
  state, hero, closing card) — it should feel special, not wallpaper.
- **Do** keep everything rounded: `rounded-2xl`/`rounded-3xl`/`rounded-full`;
  buttons are pills.
- **Do** keep white text on gradient fills; keep visible focus rings and aria
  labels.
- **Don't** hardcode hex — use tokens so light/dark both work.
- **Don't** stack multiple gradient fills next to each other; give each one air.
- **Don't** put ads in course channels, ever. It's a brand promise.
