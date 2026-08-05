# Huddl Brand Guide

Huddl is what happens when your best group chat meets your favorite study spot.
Everything in this guide exists to protect that feeling: warm, collegiate,
energetic — and trustworthy enough that students hand us their course schedule.

We are **not** corporate SaaS. If a screen, a sentence, or a color would look at
home in an enterprise dashboard, redo it.

---

## 1. The name

**huddl** (always lowercase in the wordmark, "Huddl" in prose).

- A *huddle* is the tightest formation a team makes: heads in, everyone talking,
  nobody outside the circle. That's the product — your campus, in one huddle.
- The dropped "e" is student shorthand, the way "u" replaces "you" in a text.
  It signals: built by people who text like you do.
- It's a verb waiting to happen. "Huddl up before the midterm" is the behavior
  we want, written into the name.

**Tagline:** *Your campus, in one huddle.*

Use the tagline verbatim on the landing page, app store copy, and posters. Don't
riff on it in-product ("huddle up!" as button copy is fine at launch events, not
in the app).

---

## 2. Voice & tone

Huddl sounds like the classmate who has their act together and shares their
notes anyway. Specifically:

| Principle | It means | Not |
| --- | --- | --- |
| **Warm, not chummy** | Talk *to* students, never *at* them or *down* to them | Forced slang, "Hey bestie!", corporate "we're thrilled" |
| **Concrete over clever** | Name the real thing: textbooks, rides, Week 5 notes | Vague "collaboration", "connect & engage" |
| **Energy with a plan** | Every screen tells you the next useful thing to do | Hype with no action, exclamation-point confetti |
| **Straight about privacy** | Plain sentences about what we do with data, mechanisms over promises | Legalese, or worse, cuteness about serious things |
| **Empty states recruit** | An empty list is an invitation to be first, not a dead end | "No data found." |

### Five real strings from the app (and why they work)

1. **"Campus-wide chat — say hi!"** — *#general channel description.* Seven
   words, one action. Warm without trying hard.
2. **"Be the first — add a course and its chat channel opens up for everyone
   in it."** — *empty course list.* Turns emptiness into agency; the reader is
   the spark, not the victim of a cold start.
3. **"DM classmates to trade notes, plan study sessions, or just say hi."** —
   *empty DM inbox.* Three concrete, low-stakes reasons to send a first message.
4. **"Textbooks, rides, sublets, help"** — *#asks-and-offers description.* Four
   nouns, zero fluff. This is "concrete over clever" in its purest form.
5. **"If you set up courses from a photo of your schedule, its full audit trail
   will show up here."** — *privacy notifications.* The privacy voice: calm,
   specific, mechanical. No "we take your privacy seriously" — we show the log.

### Writing mechanics

- Sentence case everywhere: headings, buttons, labels. Never Title Case Buttons.
- Contractions always ("you'll", "don't"). Second person ("your channels").
- Em dashes and commas over semicolons. One exclamation point per screen, max,
  and only where a human would actually use one.
- Course codes are proper nouns: "ECON 101A", channel slugs lowercase:
  `#econ-101a`.
- Never say "users". Say students, classmates, or you.

---

## 3. Logo

The mark is **rounded figures leaning into a huddle** — heads together, one
shape. It's drawn in `currentColor`, so it inherits whatever text color you set.

| Usage | Rule |
| --- | --- |
| Component | Always render via `<LogoMark />` or `<Wordmark />` from `src/components/logo.tsx`. Never re-draw or export flattened copies. |
| Color | Mark in `text-brand` next to foreground-colored wordmark text (the default). One-color contexts: all-foreground or all-`brand-fg` on brand backgrounds. |
| Wordmark | "huddl", lowercase, bold, tight tracking — exactly as `<Wordmark />` renders it. |
| Minimum size | Mark: 20 px. Wordmark: 88 px wide. Below that, use the mark alone. |
| Clear space | Keep a margin of at least the height of one "head" circle on all sides. |

**Don't:** rotate it, add gradients or shadows to it, outline it, recolor it
outside the token palette, put it on photos without a surface behind it, or
spell the wordmark "Huddle".

---

## 4. Color

All color in the product comes from CSS tokens in `src/app/globals.css` —
components use token classes (`bg-brand`, `text-muted`, …), never raw hex.
Both themes are first-class; check every screen in both.

The palette idea: **campus coral** on warm paper neutrals with deep ink text.
Dark mode flips to a cozy late-night-library scheme, not pure black.

### Light theme

| Token | Hex | Role |
| --- | --- | --- |
| `background` | `#faf8f5` | Page background (warm paper) |
| `foreground` | `#201f33` | Text (deep ink) |
| `surface` | `#ffffff` | Cards, sheets |
| `surface-2` | `#f2efe9` | Subtle fills, hovers, chat bubbles |
| `surface-3` | `#e9e5dd` | Pressed states, deeper fills |
| `border` | `#e3dfd6` | Hairlines |
| `muted` | `#716c7f` | Secondary text |
| `brand` | `#e85d3d` | Campus coral — primary actions, the mark |
| `brand-strong` | `#cf4526` | Hover/pressed brand, text on `brand-soft` |
| `brand-soft` | `#fdece6` | Chips, active states, soft callouts |
| `brand-fg` | `#ffffff` | Text/icons on `brand` |
| `accent` | `#2a6f77` | Teal — trust, links-adjacent, secondary identity |
| `accent-soft` | `#e3f0f1` | Soft accent fills |
| `success` | `#2e7d4f` | Confirmations, "synced" |
| `danger` | `#c73a3a` | Destructive, errors |
| `warning` | `#b97e12` | Caution |

### Dark theme

| Token | Hex | Role |
| --- | --- | --- |
| `background` | `#16151f` | Page background |
| `foreground` | `#eceaf2` | Text |
| `surface` | `#1e1d2a` | Cards |
| `surface-2` | `#262435` | Subtle fills |
| `surface-3` | `#2f2d40` | Deeper fills |
| `border` | `#363348` | Hairlines |
| `muted` | `#9b97ad` | Secondary text |
| `brand` | `#f0704f` | Coral, lifted for dark contrast |
| `brand-strong` | `#e85d3d` | Hover/pressed brand |
| `brand-soft` | `#3a2620` | Chips, active states |
| `brand-fg` | `#ffffff` | Text/icons on `brand` |
| `accent` | `#4fa3ac` | Teal, lifted |
| `accent-soft` | `#1e3335` | Soft accent fills |
| `success` | `#4caf7d` | Confirmations |
| `danger` | `#e06060` | Destructive, errors |
| `warning` | `#d9a13a` | Caution |

### Color rules

- Coral (`brand`) is for **the** action on a screen, active states, and the
  mark. If everything is coral, nothing is.
- Teal (`accent`) carries trust and secondary identity (verification, privacy,
  info). Never use it for primary CTAs.
- Marketing surfaces may build gradients and washes **from token colors only**
  (e.g. `from-brand/10`, `bg-accent/10`). In-app screens stay flat.
- `danger` is reserved for destruction and errors — never for emphasis.

---

## 5. Typography

- **Geist** (`--font-geist-sans`) for everything. It's warm-neutral, reads well
  at small chat sizes, and never looks like a bank.
- **Geist Mono** (`--font-geist-mono`) only for genuinely monospaced content:
  codes, tokens, technical identifiers.
- Hierarchy comes from **weight and spacing, not many sizes**: bold + tight
  tracking (`font-bold tracking-tight`) for headings, regular for body,
  `text-sm`/`text-xs` + `text-muted` for metadata.
- Marketing headlines: `tracking-tight`, sentence case, balance line breaks
  (`text-balance`). No all-caps except tiny kickers/labels
  (`uppercase tracking-widest text-xs`).

---

## 6. Component do / don't

**Do**

- Round generously: `rounded-card` (1rem) for cards, `rounded-full` for
  buttons, chips, avatars. Softness is part of the warmth.
- Give every list an `<EmptyState />` with a recruiting message and, where
  possible, an action.
- Give every async action a pending state: disabled control + `Loader2` with
  `animate-spin`. No dead clicks, ever.
- Use `<Avatar />` with initials fallback — people are the product; faces (or
  initials) should be everywhere messages are.
- Keep touch targets ≥ 44 px on mobile; design mobile-first, then let md+
  breathe.
- Ship visible focus states (`focus-visible:outline-*` with brand color) on
  every interactive element.

**Don't**

- Don't use raw hex, arbitrary colors, or grays outside the token set.
- Don't use sharp corners, heavy shadows, or 1-px-border-everything enterprise
  chrome. One hairline (`border-border`) and soft elevation is plenty.
- Don't stack more than one coral CTA per view.
- Don't write "No data" / "Nothing here" — empty states recruit (see voice).
- Don't introduce new icon sets; it's `lucide-react` only, generally at
  `size-4`/`size-5`, `text-muted` unless meaningful.
- Don't ship a screen you haven't looked at in dark mode.
