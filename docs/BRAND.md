# Hearth Brand Guide

Hearth is what happens when your best group chat meets your favorite study spot.
Everything in this guide exists to protect that feeling: warm, collegiate,
energetic, and trustworthy enough that students run their whole semester
through it.

We are **not** corporate SaaS. If a screen, a sentence, or a color would look at
home in an enterprise dashboard, redo it.

---

## 1. The name

**hearth** (always lowercase in the wordmark, "Hearth" in prose).

- A *hearth* is the warm center of a house: the fire everyone ends up sitting
  around without being asked to. That's the product: the place your campus
  gathers at the end of the day.
- The app was called Huddl until August 2026; it was renamed over a
  likelihood-of-confusion risk with Hudl, the sports platform. The rename was
  a gift: the palette was already ember-and-cream, the design system already
  calls its cards "Hearth cards", and the accent color was already named
  `ember`. The name caught up with the design.
- The domain is **uhearth.app** ("u" + hearth, your hearth), so the bundle id
  is `app.uhearth.mobile`. The product name in prose is Hearth alone; the "u"
  lives only in the domain and identifiers derived from it.

**Tagline:** *Your campus, gathered.*

Use the tagline verbatim on the landing page, app store copy, and posters.
Don't riff on it in-product.

---

## 2. Voice & tone

Hearth sounds like the classmate who has their act together and shares their
notes anyway. Specifically:

| Principle | It means | Not |
| --- | --- | --- |
| **Warm, not chummy** | Talk *to* students, never *at* them or *down* to them | Forced slang, "Hey bestie!", corporate "we're thrilled" |
| **Concrete over clever** | Name the real thing: textbooks, rides, Week 5 notes | Vague "collaboration", "connect & engage" |
| **Energy with a plan** | Every screen tells you the next useful thing to do | Hype with no action, exclamation-point confetti |
| **Straight about privacy** | Plain sentences about what we do with data, mechanisms over promises | Legalese, or worse, cuteness about serious things |
| **Empty states recruit** | An empty list is an invitation to be first, not a dead end | "No data found." |

### Five real strings from the app (and why they work)

1. **"Campus-wide chat, say hi!"** (*#general channel description*). Four
   words, one action. Warm without trying hard.
2. **"Be the first. Add a course and its chat channel opens up for everyone
   in it."** (*empty course list*). Turns emptiness into agency. The reader is
   the spark, not the victim of a cold start.
3. **"DM classmates to trade notes, plan study sessions, or just say hi."**
   (*empty DM inbox*). Three concrete, low-stakes reasons to send a first
   message.
4. **"Textbooks, rides, sublets, help"** (*#asks-and-offers description*). Four
   nouns, zero fluff. This is "concrete over clever" in its purest form.
5. **"You've never stored an image with Hearth. If you had, its full audit trail
   would live here: every access logged, every log a notification."**
   (*privacy dashboard, empty*). The privacy voice: calm, specific, mechanical.
   Instead of "we take your privacy seriously", we show the log.

### Writing mechanics

- Sentence case everywhere: headings, buttons, labels. Never Title Case Buttons.
- Contractions always ("you'll", "don't"). Second person ("your channels").
- Commas and periods over semicolons. One exclamation point per screen, max,
  and only where a human would actually use one.
- Course codes are proper nouns: "ECON 101A", channel slugs lowercase:
  `#econ-101a`.
- Never say "users". Say students, classmates, or you.

---

## 3. Logo

The mark is **three heads leaning together inside a speech bubble**.

The bubble is the category: this is a place where people talk, and an icon on a
home screen has about a tenth of a second to say so. The three heads inside are
the gathering. The middle one sits a little larger and a little higher, the way
the person leaning furthest in always is. They're *cut out* of the bubble rather
than drawn on top of it, so the entire mark is one path in one color, drawn in
`currentColor`. That's what lets it sit on an ember tile, in a cream nav bar,
and in a monochrome Android notification tray without a second artwork existing
anywhere.

Two arrangements were tried and rejected; they're recorded here so nobody
re-discovers them. Heads evenly spaced around a **closed** ring always resolve
into a flower: five petals, or a four-leaf clover at four. And **two heads
above one below** reads as a face (two eyes and an open mouth) at any size over
about 40 px.

| Usage | Rule |
| --- | --- |
| Component | Always render via `<LogoMark />` or `<Wordmark />` from `src/components/logo.tsx`. Never re-draw or export flattened copies. |
| App icons | All of `mobile/assets/images/*.png` and `public/icons/*.svg` are generated from the same path as `<LogoMark />`. If the mark changes, regenerate them together. The mobile icon was an unrelated "h." monogram for a while, and one mark that is actually one mark is the point. |
| Color | Mark in `text-brand` next to foreground-colored wordmark text (the default). One-color contexts: all-foreground or all-`brand-fg` on brand backgrounds. App-icon / tile contexts: `brand-fg` mark on a **solid ember** (`bg-brand`) tile. The gradient tile is retired. |
| Wordmark | "hearth", lowercase, bold, tight tracking, exactly as `<Wordmark />` renders it. |
| Minimum size | Mark: 20 px. Wordmark: 88 px wide. Below that, use the mark alone. |
| Clear space | Keep a margin of at least the height of one "head" circle on all sides. |

**Don't:** rotate it, add gradients or shadows to it, outline it, recolor it
outside the token palette, put it on photos without a surface behind it, or
spell the wordmark "Hearth" with a capital H, or write "uhearth" anywhere a
person reads.

---

## 4. Color

All color in the product comes from CSS tokens in `src/app/globals.css`.
Components use token classes (`bg-brand`, `text-muted`, …), never raw hex.
Both themes are first-class; check every screen in both. Since UI v2, students
can also pin a theme with the in-app toggle (light / system / dark). The
tokens handle it, and components never branch on theme.

The palette idea: **ember** terracotta on warm cream paper with espresso-ink
text, **clay** softs for chips and callouts, and **fern** for trust. Dark
mode is a candle-lit den: warm browns, never blue-black.

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
| `brand` | `#b5502f` | Ember: primary fills, active states, the mark |
| `brand-strong` | `#9c3f22` | Hover/pressed brand fills |
| `brand-soft` | `#f6e3d7` | Clay: chips, active states, soft callouts |
| `brand-2` | `#d97742` | Warm ember highlight: decorative fills only (illustration accents) |
| `brand-fg` | `#ffffff` | Text/icons ON brand fills (AA) |
| `brand-ink` | `#8f3a1f` | Readable brand-colored text on soft/neutral fills (AA on `brand-soft`) |
| `on-solid` | `#ffffff` | White text on saturated status fills (accent/success/danger) |
| `accent` | `#56682d` | Fern: trust, links-adjacent, secondary identity |
| `accent-soft` | `#e9edd8` | Soft accent fills |
| `success` | `#25683f` | Confirmations, "synced" |
| `danger` | `#b32d2d` | Destructive, errors |
| `warning` | `#8a5c00` | Caution |

### Dark theme

| Token | Hex | Role |
| --- | --- | --- |
| `background` | `#1c1612` | Page background (candle-lit den, warm brown, never blue-black) |
| `foreground` | `#f2ebe1` | Text |
| `surface` | `#262019` | Cards |
| `surface-2` | `#322a21` | Subtle fills |
| `surface-3` | `#3e352a` | Deeper fills |
| `border` | `#453b2e` | Hairlines |
| `muted` | `#b3a28e` | Secondary text |
| `brand` | `#e0764b` | Ember, lifted for dark contrast |
| `brand-strong` | `#cf5f33` | Hover/pressed brand fills |
| `brand-soft` | `#40291c` | Chips, active states |
| `brand-2` | `#e8955f` | Warm ember highlight: decorative fills only (illustration accents) |
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
- `brand-2` is decorative only: the warm highlight inside illustrations
  (steam, crumbs) and tiny ornament fills. Never a flat UI fill, never a
  text color.
- **No gradient utilities.** `.bg-gradient-brand` and `.text-gradient-brand`
  were retired in v3. Emphasis comes from weight and size, never gradient
  text. Kickers/eyebrows above headings are banned per the craft-floor rules:
  headings carry their own weight.
- Soft washes built **from token colors only** (e.g. `bg-brand/10`,
  `bg-accent/10`) are fine on marketing surfaces. In-app screens stay calm:
  soft elevation (`shadow-soft`), nothing louder.
- Never gray on a colored surface: secondary text on a tinted fill
  (`bg-brand-soft`, `bg-accent-soft`) tints from the surface hue
  (`text-brand-ink`, `text-accent`), not `text-muted`.
- `danger` is reserved for destruction and errors, never for emphasis.

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
  characterful, so let it carry the personality.
- **Plus Jakarta Sans** (`--font-body-var`) for body and UI. Warm, humanist,
  reads well at small chat sizes, never looks like a bank.
- **JetBrains Mono** (`--font-mono-var`) only for genuinely monospaced
  content: codes, tokens, technical identifiers.
- Hierarchy comes from **weight and spacing, not many sizes**: bold + tight
  tracking (`font-bold tracking-tight`) for headings, regular for body,
  `text-sm`/`text-xs` + `text-muted` for metadata.
- Marketing headlines: `tracking-tight`, sentence case, balance line breaks
  (`text-balance`). No all-caps, and no kickers/eyebrows above headings.
  Headings carry their own weight.

---

## 6. Component do / don't

**Do**

- Round generously: `rounded-card` (1.25rem) for cards, `rounded-full` for
  buttons, chips, avatars. Softness is part of the warmth.
- Give every list an `<EmptyState />` with a recruiting message and, where
  possible, an action.
- Give every async action a pending state: disabled control + `Loader2` with
  `animate-spin`. No dead clicks, ever.
- Use `<Avatar />` with initials fallback. People are the product, and faces
  (or initials) should be everywhere messages are.
- Keep touch targets ≥ 44 px on mobile; design mobile-first, then let md+
  breathe.
- Ship visible focus states (`focus-visible:outline-*` with brand color) on
  every interactive element.

**Don't**

- Don't use raw hex, arbitrary colors, or grays outside the token set.
- Don't use sharp corners, heavy shadows, or 1-px-border-everything enterprise
  chrome. One hairline (`border-border`) and soft elevation is plenty.
- Don't stack more than one ember CTA per view.
- Don't reach for sparkles or gradient text. They're the AI tells. Decorative
  accents are homey and hand-drawn: steam curls, crumb dots, stitch dashes
  (see `@/components/illustrations`).
- Don't write "No data" / "Nothing here". Empty states recruit (see voice).
- Don't introduce new icon sets; it's `lucide-react` only, generally at
  `size-4`/`size-5`, `text-muted` unless meaningful.
- Don't ship a screen you haven't looked at in dark mode.
