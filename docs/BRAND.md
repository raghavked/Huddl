# Huddl Brand Guide

Huddl is what happens when your best group chat meets your favorite study spot.
Everything in this guide exists to protect that feeling: warm, collegiate,
energetic — and trustworthy enough that students run their whole semester
through it.

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
5. **"You've never stored an image with Huddl. If you had, its full audit trail
   would live here — every access logged, every log a notification."** —
   *privacy dashboard, empty.* The privacy voice: calm, specific, mechanical.
   No "we take your privacy seriously" — we show the log.

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
| Color | Mark in `text-brand` next to foreground-colored wordmark text (the default). One-color contexts: all-foreground or all-`brand-fg` on brand backgrounds. App-icon / tile contexts: `brand-fg` mark on a **solid ember** (`bg-brand`) tile — the gradient tile is retired. |
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

The palette idea: **ember** terracotta on warm cream paper with espresso-ink
text, **clay** softs for chips and callouts, and **fern** for trust. Dark
mode is a candle-lit den — warm browns, never blue-black.

### Light theme

| Token | Hex | Role |
| --- | --- | --- |
| `background` | `#faf6ee` | Page background (warm cream paper) |
| `foreground` | `#2b2118` | Text (espresso ink) |
| `surface` | `#fffcf5` | Cards, sheets |
| `surface-2` | `#f3ecdd` | Subtle fills, hovers, chat bubbles |
| `surface-3` | `#eae1cd` | Pressed states, deeper fills |
| `border` | `#e6dcc8` | Hairlines |
| `muted` | `#6b5d4f` | Secondary text |
| `brand` | `#b5502f` | Ember — primary fills, active states, the mark |
| `brand-strong` | `#9c3f22` | Hover/pressed brand fills |
| `brand-soft` | `#f6e3d7` | Clay — chips, active states, soft callouts |
| `brand-2` | `#d97742` | Warm ember highlight — decorative fills only (illustration accents) |
| `brand-fg` | `#ffffff` | Text/icons ON brand fills (AA) |
| `brand-ink` | `#8f3a1f` | Readable brand-colored text on soft/neutral fills (AA on `brand-soft`) |
| `on-solid` | `#ffffff` | White text on saturated status fills (accent/success/danger) |
| `accent` | `#56682d` | Fern — trust, links-adjacent, secondary identity |
| `accent-soft` | `#e9edd8` | Soft accent fills |
| `success` | `#25683f` | Confirmations, "synced" |
| `danger` | `#b32d2d` | Destructive, errors |
| `warning` | `#8a5c00` | Caution |

### Dark theme

| Token | Hex | Role |
| --- | --- | --- |
| `background` | `#1c1612` | Page background (candle-lit den — warm brown, never blue-black) |
| `foreground` | `#f2ebe1` | Text |
| `surface` | `#262019` | Cards |
| `surface-2` | `#322a21` | Subtle fills |
| `surface-3` | `#3e352a` | Deeper fills |
| `border` | `#453b2e` | Hairlines |
| `muted` | `#b3a28e` | Secondary text |
| `brand` | `#e0764b` | Ember, lifted for dark contrast |
| `brand-strong` | `#cf5f33` | Hover/pressed brand fills |
| `brand-soft` | `#40291c` | Chips, active states |
| `brand-2` | `#e8955f` | Warm ember highlight — decorative fills only (illustration accents) |
| `brand-fg` | `#2b1408` | Dark-espresso text/icons ON brand fills (light ember needs dark, not white) |
| `brand-ink` | `#eda07b` | Readable brand-colored text on soft/neutral fills |
| `on-solid` | `#ffffff` | White text on saturated status fills |
| `accent` | `#8ba852` | Fern, lifted |
| `accent-soft` | `#262e1a` | Soft accent fills |
| `success` | `#4caf7d` | Confirmations |
| `danger` | `#e06060` | Destructive, errors |
| `warning` | `#d9a13a` | Caution |


### Color rules

- Ember (`brand`) is for **the** action on a screen, active states, and the
  mark. If everything is ember, nothing is.
- Fern (`accent`) carries trust and secondary identity (verification, privacy,
  info). Never use it for primary CTAs.
- `brand-2` is decorative only — the warm highlight inside illustrations
  (steam, crumbs) and tiny ornament fills. Never a flat UI fill, never a
  text color.
- **No gradient utilities** — `.bg-gradient-brand` and `.text-gradient-brand`
  were retired in v3. Emphasis comes from weight and size, never gradient
  text. Kickers/eyebrows above headings are banned per the craft-floor rules
  — headings carry their own weight.
- Soft washes built **from token colors only** (e.g. `bg-brand/10`,
  `bg-accent/10`) are fine on marketing surfaces. In-app screens stay calm:
  soft elevation (`shadow-soft`), nothing louder.
- Never gray on a colored surface: secondary text on a tinted fill
  (`bg-brand-soft`, `bg-accent-soft`) tints from the surface hue
  (`text-brand-ink`, `text-accent`), not `text-muted`.
- `danger` is reserved for destruction and errors — never for emphasis.

See `docs/UI.md` for the UI v3 "hearth" system itself: elevation scale,
motion, glass surfaces, primitives (`src/components/ui/`), and layout
patterns.

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
  (`text-balance`). No all-caps, and no kickers/eyebrows above headings —
  they're banned; headings carry their own weight.

---

## 6. Component do / don't

**Do**

- Round generously: `rounded-card` (1.25rem) for cards, `rounded-full` for
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
- Don't stack more than one ember CTA per view.
- Don't reach for sparkles or gradient text — they're the AI tells. Decorative
  accents are homey and hand-drawn: steam curls, crumb dots, stitch dashes
  (see `@/components/illustrations`).
- Don't write "No data" / "Nothing here" — empty states recruit (see voice).
- Don't introduce new icon sets; it's `lucide-react` only, generally at
  `size-4`/`size-5`, `text-muted` unless meaningful.
- Don't ship a screen you haven't looked at in dark mode.
