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
Both themes are first-class; check every screen in both. Since UI v2, students
can also pin a theme with the in-app toggle (light / system / dark) — the
tokens handle it, components never branch on theme.

The palette idea: **campus violet** on cool paper neutrals with deep
violet-ink text, a **raspberry** partner that exists only inside the brand
gradient, and **jade** for trust. Dark mode flips to a midnight-quad scheme,
not pure black.

### Light theme

| Token | Hex | Role |
| --- | --- | --- |
| `background` | `#f8f7fc` | Page background (cool paper) |
| `foreground` | `#17142b` | Text (violet ink) |
| `surface` | `#ffffff` | Cards, sheets |
| `surface-2` | `#f0edf8` | Subtle fills, hovers, chat bubbles |
| `surface-3` | `#e7e3f4` | Pressed states, deeper fills |
| `border` | `#e4e0f0` | Hairlines |
| `muted` | `#5f5b73` | Secondary text |
| `brand` | `#6c3df4` | Campus violet — primary fills, active states, the mark |
| `brand-strong` | `#5527d9` | Hover/pressed brand fills |
| `brand-soft` | `#ece6fe` | Chips, active states, soft callouts |
| `brand-2` | `#d6336c` | Raspberry — gradient partner ONLY |
| `brand-fg` | `#ffffff` | Text/icons ON brand + gradient fills (AA at every stop) |
| `brand-ink` | `#5527d9` | Readable brand-colored text on soft/neutral fills |
| `on-solid` | `#ffffff` | White text on saturated status fills (accent/success/danger) |
| `accent` | `#0b6e69` | Jade — trust, links-adjacent, secondary identity |
| `accent-soft` | `#d9f2ee` | Soft accent fills |
| `success` | `#25683f` | Confirmations, "synced" |
| `danger` | `#b32d2d` | Destructive, errors |
| `warning` | `#8a5c00` | Caution |

### Dark theme

| Token | Hex | Role |
| --- | --- | --- |
| `background` | `#131020` | Page background |
| `foreground` | `#eeecf6` | Text |
| `surface` | `#1b1730` | Cards |
| `surface-2` | `#241f3d` | Subtle fills |
| `surface-3` | `#2e2849` | Deeper fills |
| `border` | `#363052` | Hairlines |
| `muted` | `#a09cb8` | Secondary text |
| `brand` | `#7a52f5` | Violet, lifted for dark contrast |
| `brand-strong` | `#6c3df4` | Hover/pressed brand fills |
| `brand-soft` | `#2c2151` | Chips, active states |
| `brand-2` | `#d6336c` | Raspberry — gradient partner ONLY |
| `brand-fg` | `#ffffff` | Text/icons ON brand + gradient fills |
| `brand-ink` | `#b39dff` | Readable brand-colored text on soft/neutral fills |
| `on-solid` | `#ffffff` | White text on saturated status fills |
| `accent` | `#3ec9b8` | Jade, lifted |
| `accent-soft` | `#123230` | Soft accent fills |
| `success` | `#4caf7d` | Confirmations |
| `danger` | `#e06060` | Destructive, errors |
| `warning` | `#d9a13a` | Caution |


### Color rules

- Violet (`brand`) is for **the** action on a screen, active states, and the
  mark. If everything is violet, nothing is.
- Jade (`accent`) carries trust and secondary identity (verification, privacy,
  info). Never use it for primary CTAs.
- `brand-2` never appears alone — only inside `.bg-gradient-brand` /
  `.text-gradient-brand`. The gradient is the v2 signature: hero CTAs,
  marketing headlines, the logo tile, and at most *the* single CTA on a
  setup or empty screen in-app.
- Marketing surfaces may build gradients and washes **from token colors only**
  (e.g. `from-brand/10`, `bg-accent/10`). In-app screens stay calm: soft
  elevation (`shadow-soft`), not gradients.
- `danger` is reserved for destruction and errors — never for emphasis.

See `docs/UI.md` for the UI v2 system itself: elevation scale, motion,
glass surfaces, primitives (`src/components/ui/`), and layout patterns.

---

## 5. Typography

An open-source (OFL) humanist pairing, loaded via `next/font` in
`src/app/layout.tsx`:

- **Bricolage Grotesque** (`--font-display-var`) for display: `h1`–`h3` get it
  automatically via `globals.css`; use the `font-display` utility for
  non-heading display text (the wordmark, hero numerals). It's vibrant and
  characterful — let it carry the personality.
- **Plus Jakarta Sans** (`--font-body-var`) for body and UI. Warm, humanist,
  reads well at small chat sizes, never looks like a bank.
- **JetBrains Mono** (`--font-mono-var`) only for genuinely monospaced
  content: codes, tokens, technical identifiers.
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
- Don't stack more than one violet CTA per view.
- Don't write "No data" / "Nothing here" — empty states recruit (see voice).
- Don't introduce new icon sets; it's `lucide-react` only, generally at
  `size-4`/`size-5`, `text-muted` unless meaningful.
- Don't ship a screen you haven't looked at in dark mode.
