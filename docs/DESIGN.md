# The Hearth Design Language

**Read this on day one. It is the whole system.**

> **Which doc?** This one owns the design language itself — palette, type,
> spacing, elevation, motion, copy voice, the craft floor — and the native app
> in `mobile/` that renders it (React Native primitives from
> `@/components/ui`, `useTheme()`, `Animated`). Its companion, `docs/UI.md`,
> owns the **web** side: how these same decisions land as Tailwind tokens and
> `src/components/ui/` in the Next.js app. When they disagree about a value,
> this file is right and the other is stale. Keep them separate; a change to a
> token or a rule belongs in both.

Huddl is a campus community platform for college students, launching at UC
Davis. Everything a student does in a semester — their classes, their clubs,
their group chats, their study nights, their calendar — lives in one app.

That is a lot of surface area, and surface area is where products go cold.
Hearth is our defense against that. The whole language is built around one
image: **a warm kitchen table where your people already are.** Cream paper and
espresso ink. An ember that glows rather than shouts. A dark theme that is
candle-lit, not switched-off. Hand-drawn marks where a lesser app would put a
spinner.

If a screen, a sentence, or a color would look at home in an enterprise
dashboard, it is wrong. Redo it.

---

## 1. Color

Two palettes, same token names, both always shipped. Nothing in the app picks a
raw hex — every color comes from `useTheme()`, which returns the palette for
the active appearance.

```tsx
import { useTheme } from "@/hooks/use-theme";
const theme = useTheme();
// theme.foreground — NOT theme.text
```

### Light — cream paper, espresso ink

| Token | Hex | Role |
| --- | --- | --- |
| `background` | `#faf6ee` | The page. Warm cream, never white. |
| `foreground` | `#2b2118` | All primary text and icons. Espresso, never black. |
| `surface` | `#fffcf5` | Cards, sheets, inputs — the paper on the table. |
| `surface2` | `#f3ecdd` | Recessed fills: neutral chips, skeletons, avatar circles. |
| `surface3` | `#eae1cd` | The rare third step — pressed rows, nested wells. |
| `border` | `#e6dcc8` | Every hairline. 1px, always. |
| `muted` | `#6b5d4f` | Secondary text: captions, metadata, section labels. |
| `brand` | `#b5502f` | The ember. Primary buttons, active icons, accents. |
| `brandStrong` | `#9c3f22` | Deeper ember for pressed/active brand fills. |
| `brandSoft` | `#f6e3d7` | Soft clay wash behind brand chips, icon tiles, badges. |
| `brand2` | `#d97742` | Highlight ember. **Decoration only** — illustration accents. Never a flat fill or a text color. |
| `brandFg` | `#ffffff` | Text and icons *on* a `brand` fill. |
| `brandInk` | `#8f3a1f` | Brand-colored **text** on a soft or neutral fill. |
| `onSolid` | `#ffffff` | Foreground on saturated status fills (success, danger, accent solids). |
| `accent` | `#56682d` | Fern. Scheduled, graded, verified — the "this is handled" green. |
| `accentSoft` | `#e9edd8` | Soft fern wash behind accent chips. |
| `success` | `#25683f` | Completed, confirmed, checked off. |
| `danger` | `#b32d2d` | Destructive actions and error text. |
| `warning` | `#8a5c00` | Overdue, expiring, needs attention — short of an error. |

### Dark — the candle-lit den

Dark is not light inverted. It is the same room at night: warm browns, a
brighter ember so it still reads as fire, and *no blue anywhere*. If a dark
screen ever looks slate or navy, a raw color slipped in.

| Token | Hex | Notes |
| --- | --- | --- |
| `background` | `#1c1612` | Deep warm brown. |
| `foreground` | `#f2ebe1` | Warm off-white, never `#fff`. |
| `surface` | `#262019` | |
| `surface2` | `#322a21` | |
| `surface3` | `#3e352a` | |
| `border` | `#453b2e` | Carries more of the depth work than in light. |
| `muted` | `#b3a28e` | |
| `brand` | `#e0764b` | Ember, turned up so it still glows on brown. |
| `brandStrong` | `#cf5f33` | |
| `brandSoft` | `#40291c` | A dark clay, not a light wash. |
| `brand2` | `#e8955f` | Decoration only, same as light. |
| `brandFg` | `#2b1408` | **Dark** text on the brand fill — this flips between themes. |
| `brandInk` | `#eda07b` | |
| `onSolid` | `#ffffff` | |
| `accent` | `#8ba852` | |
| `accentSoft` | `#262e1a` | |
| `success` | `#4caf7d` | |
| `danger` | `#e06060` | |
| `warning` | `#d9a13a` | |

### The rules that actually get broken

1. **No raw hex in a component.** Ever. If you need a translucent version of a
   token, append an alpha suffix to the token (`theme.danger + "1f"`), don't
   type a new color.
2. **No pure grey, black, or white.** Not `#000`, not `#fff`, not `#888`. Every
   neutral in this app has warmth in it. The one exception is `brandFg` /
   `onSolid` in light, which are genuinely white by design.
3. **Never `muted` text on a colored surface.** On `brandSoft`, brand text is
   `brandInk` and icons are `brand`. Secondary text on a tinted fill takes its
   tint from that fill — it does not fall back to grey.
4. **`brandFg` vs `brandInk` is the mistake everyone makes once.** `brandFg` is
   for text sitting *on* a saturated `brand` fill. `brandInk` is for brand text
   sitting on a *soft* fill. Swapping them produces the two worst-contrast
   pairs in the palette.
5. **Both themes, always.** Every screen ships light and dark in the same PR.
   A screen is not done until you have looked at it in both.

---

## 2. Type

**Bricolage Grotesque** for display, **Plus Jakarta Sans** for everything else.
Bricolage has personality — a little squared, a little humanist — and that
personality is the entire reason a title feels like Huddl and not like a
framework default. It appears in exactly two places: screen titles and card
titles. Everywhere else is Jakarta.

All of it comes through `AppText`; never reach for React Native's `Text`.

| Variant | Font | Size / line | Use it for |
| --- | --- | --- | --- |
| `display` | Bricolage Bold | 28 / 34 | The screen title. **One per screen.** |
| `title` | Bricolage SemiBold | 17 / 22 | Card headings, sheet headings, section groups inside a card. |
| `body` | Jakarta Regular | 15 / 21 | Paragraphs, message text, descriptions. |
| `bodyMedium` | Jakarta Medium | 15 / 21 | A body line that needs slight emphasis — sheet rows, list labels. |
| `bodySemi` | Jakarta SemiBold | 15 / 21 | The primary line of a list row. Names, titles, the thing being tapped. |
| `caption` | Jakarta Regular | 12 / 16 | Metadata, timestamps, helper text. Nearly always `muted`. |
| `label` | Jakarta SemiBold | 12 / 16 | Chips, section labels, small buttons, form field labels. |

```tsx
<AppText variant="bodySemi">{course.title}</AppText>
<AppText variant="caption" muted>Due tomorrow · 11:59 PM</AppText>
```

`muted` is a boolean prop, not a color you pass. Use it; don't hand-set
`color: theme.muted`.

**Sentence case everywhere.** Titles, buttons, chips, labels, empty states,
alerts. Title Case reads as marketing; ALL CAPS reads as shouting. The one
sanctioned exception is `SectionLabel`, which uppercases a one- or two-word
group name at 12px with `letterSpacing: 1.2` — a texture, not a voice.

---

## 3. Space, radius, elevation, motion

### Spacing — `space` in `@/constants/theme`

Ten rungs. The names describe the **relationship**, not the size, so a screen
reads as an argument about hierarchy rather than a pile of numbers.

| Token | Value | Where |
| --- | --- | --- |
| `hair` | 2 | A nudge. Optical alignment, the gap under a label. |
| `tight` | 4 | Parts of one thing: an icon and its count. |
| `snug` | 6 | Inside a chip, a two-line stack. |
| `cosy` | 8 | Between siblings in a row. Between chips. |
| `room` | 10 | A list row's vertical breathing. |
| `close` | 12 | Between rows in a group, between the parts of a card. |
| `card` | 16 | `Card`'s own padding, and the gap between cards. |
| `gutter` | 20 | **The screen gutter.** Every screen, both edges. |
| `chapter` | 24 | Above a `SectionLabel`. |
| `rest` | 32 | The bottom of a scroll; the air around an empty state. |

These were not invented. Four are structural facts already load-bearing —
`Card` pads by 16, `Screen` gutters by 20 and ends at 32, `SectionLabel` puts
24 above itself — and the small end is what the screens had already converged
on. The values that showed up a handful of times each (3, 5, 7, 9, 14, 18) are
the drift the ladder exists to stop.

Screens start at `insets.top + 12` and end at `insets.bottom + space.rest`.
`Screen` from `@/components/screen` does this for you — use it unless the
screen needs a custom header.

One-off optical fixes are exempt: a 3px nudge to sit a glyph on a baseline is
a real thing, should stay 3, and should carry a comment saying why. The ladder
is a rule for anything structural.

**Generous over dense.** When a layout is ambiguous, add the air. This is a
place people spend an evening, not a console they scan for six seconds. When a
screen feels cramped the fix is almost never a colour — it is `cosy` where the
content wanted `gutter`.

### Radius — `@/constants/theme`

| Token | Value | Use |
| --- | --- | --- |
| `radius.card` | 20 | Cards, sheets, modals, images. |
| `radius.control` | 12 | Inputs, icon tiles, small square affordances. |
| `radius.full` | 999 | Buttons, chips, avatars, checkboxes. |

Three values. Nothing in the app has a radius that isn't one of them.

### Elevation — `elevation`, `elevationFor(scheme)`

A warm three-step shadow scale. The ink is a palette brown, not grey — the
shadow should read as lamplight falling past an object.

| Step | Meaning |
| --- | --- |
| `rest` | Sitting on the page. `Card`'s default; nine surfaces in ten. |
| `raised` | Lifted off the page — a menu, a popover, a dragged row. |
| `floating` | Top of the stack — bottom sheets and modals. |

```tsx
const scheme = useColorScheme();
<View style={{ ...elevationFor(scheme).raised, backgroundColor: theme.surface }} />
// or, usually:
<Card elevation="floating" />
```

**Dark mode leans on surface contrast, not shadow.** A brown shadow on a
candle-dark background is invisible, and raising the opacity until it shows
reads as soot. So the dark values are softer — `rest` drops the Android
elevation to zero outright — and depth in dark comes from `surface` →
`surface2` → `surface3` stepping away from `background`, plus the hairline
border.

### Motion — `motion`

| Token | ms | Use |
| --- | --- | --- |
| `instant` | 0 | The reduced-motion duration. Pass it instead of branching. |
| `quick` | 140 | Press feedback, a chip selecting, a checkbox filling. |
| `base` | 240 | The default. Sheets, expanding cards, rows settling in. |
| `slow` | 320 | Full-screen transitions, the skeleton pulse. Rare. |

House easing lives in `motion.easing`. Three curves, and a screen should never
reach past them into `react-native`'s `Easing` to invent a fourth.

| Token | Curve | Use |
| --- | --- | --- |
| `standard` | `inOut` cubic | **Reversible** things. Press in and out, open and close, select and deselect. Leaving and returning along the same curve is what makes an undo feel like the same gesture backwards. The one to pick when you are not sure. |
| `enter` | `out` cubic | **Arrivals.** Something entering that will not immediately leave: a newly inserted row, a card on first paint, a button settling back under a lifted finger. Quick off the mark, slow into place. |
| `exit` | `in` cubic | **Departures.** A sheet being dismissed, a row coming off a list. Slow to let go, then gone. Never on something arriving — an arrival that accelerates away from you reads as a glitch. |

```tsx
Animated.timing(enter, {
  toValue: 1,
  duration: reduceMotion ? motion.instant : motion.base,
  easing: motion.easing.enter,
  useNativeDriver: true,
}).start();
```

Arrivals and departures are asymmetric on purpose. A thing takes its time
settling in and leaves without lingering, which is how objects behave and
exactly how a press should feel: quick in, slower out.

**The rule: motion is for arrival and completion, never decoration.** Animate a
thing that just appeared or a thing the user just finished. Nothing loops to be
noticed, nothing bounces for personality, nothing moves because the screen
would otherwise be still. If you cannot name the moment the animation is
reporting, delete it.

Animation is `react-native`'s `Animated` only. No animation libraries.

**What the primitives already do.** Before you animate anything on a screen,
check whether the primitive under it is already reporting the moment.

- **`Button`** — a press sinks it 3% and dims it a shade: down in `quick` on
  `standard`, back up in `base` on `enter`. The uneven return is the whole
  difference between tapping glass and pressing something soft.
- **`Card`** — `entrance={index}` opts a list into the arrival: fade plus 8px
  of rise on `enter`, staggered 40ms a row and capped after seven so nobody
  waits on row thirty. The index is read once, at mount, so a re-sort does not
  replay the list. Use it where rows genuinely just landed; leave it off for a
  filter re-render.
- **`Chip`** — becoming selected swells the pill 5% and settles it back, so a
  choice in a filter row is not carried by two shades of soft fill alone.
  Deselecting is a removal and gets no flourish.
- **`Skeleton`** — `pulse` breathes between full and half opacity at `slow` on
  `standard`. Still off by default; see the primitive's note.

**The motion contract.** Every animated primitive calls `useReducedMotion()`
first, and reduce motion never means "skip the state change" — it means **land
the final state in `motion.instant`**. A chip that never fills, a card that
never appears, a button stuck at 97% is a bug, not an accommodation. A
primitive that cannot be turned off this way is not finished.

### Haptics

`tapLight` / `tapSuccess` from `@/lib/haptics`, at **completion moments only**:
a task checked off, a message sent, an RSVP confirmed. Never on navigation,
never on a keystroke, never twice for the same event.

---

## 4. The primitive catalog

Everything comes from `@/components/ui`. If you are writing a `<View>` with a
`borderRadius` and a background, check this list first — the odds are it
already exists, and hand-rolling is how a design system dies.

| Primitive | One line |
| --- | --- |
| `AppText` | All text. Pick a `variant`; add `muted` for secondary. |
| `Button` | `primary` / `secondary` / `soft` / `ghost` / `danger`, in `sm` / `md` / `lg`. `pending` swaps the icon for a spinner and disables it. Presses sink 3% and settle back. |
| `Card` | Warm surface, hairline border, `rest` elevation. `padded={false}` when you're building a row; `entrance={index}` for the staggered list arrival. |
| `Field` | Labeled text input with inline error text. Ember caret and selection. |
| `Chip` | The pill: course codes, kinds, roles, filters. `tone` = `brand` (identity) / `accent` (scheduled or graded) / `neutral` (metadata) / `danger` (notice this). Add `onPress` and it becomes a 44px-target toggle with a hairline, `accessibilityState`, and a small swell as it selects. |
| `EmptyState` | The dashed card for an empty list. `icon` **or** `illustration`, a title, a body, and an `action` when the reader can fix it themselves. `compact` for an empty section nested in a fuller screen. |
| `SectionLabel` | The uppercase muted group heading — 24 above, 12 below, `letterSpacing: 1.2`. Optional right-hand `action` with a chevron and a 44px hit area. |
| `Sheet` | Bottom action sheet: candle-dark scrim, card slides up, safe-area aware, `floating` elevation. `Sheet.Row` is the 44px icon-tile row every caller needs, with a `danger` tone for the destructive choice and `selected` for the current one in a picker. Two to five rows; more than that wants a screen. |
| `Skeleton` / `SkeletonRow` | Still `surface2` ghost blocks for a first paint whose shape you can honestly predict. **No shimmer** — opt into a gentle `pulse` only for a genuinely long wait. |
| `useReducedMotion` | Live OS reduce-motion state. Ask before you animate. |
| `Avatar` (`@/components/avatar`) | The one way we draw a person: photo, or two initials on an ember-or-fern circle tinted by a stable hash of their name. Decorative — the name is always rendered beside it. |
| `Screen` (`@/components/screen`) | Safe-area scaffold + display title + optional header action. |
| Illustrations (`@/components/illustrations`) | `Mug`, `Doorway`, `PaperPlane`, `Pennant`, `Lantern`, `PinnedNote`, `WallCalendar`, `MagnifyingGlass`, `Tray`, `Shoebox`. Hand-drawn stroke marks, deliberately imperfect. Pass `color` and `softColor` from the theme. |

### The one recorded exception

`mobile/src/app/blocked.tsx` draws its own 44px circle — `surface2`, muted
initials, no photo, no tint — instead of `Avatar`. `Avatar`'s name-hash tint is
what makes a person recognizable at a glance, and that is precisely wrong on
the block list: a column of ember and fern circles turns a settings chore into
something that reads like a friends list. It is the only sanctioned copy of an
`Avatar`, it is commented as such at the call site, and it stays a one-off. A
second screen wanting the same quiet person-mark is the signal to give `Avatar`
a documented variant, not to paste the circle a third time.

That is the shape every exception takes: named here, commented there, and
capped at one.

### Choosing an illustration

They are moods, not clip art. Use the one whose mood is true.

- **Mug** — settle in, nothing here is a problem. Benign empties.
- **Doorway** — there's a room on the other side and you're invited. Things you
  haven't joined yet.
- **PaperPlane** — the first message is halfway there. Empty conversations.
- **Pennant** — somebody should start the club, and it might as well be you.
- **Lantern** — hold the light up and look around. Search and discovery, *before*
  the query: the browse screen, the first visit to a directory.
- **PinnedNote** — the board is up and nothing is on it, so whatever goes up
  first is what everybody reads. A board with no posts.
- **WallCalendar** — a whole term laid flat, and you are somewhere in the middle
  of it. The semester overview, and a week with nothing on it.
- **MagnifyingGlass** — curious, not defeated. The query came back with nothing,
  and looking closer is still the interesting part. Pair it with copy that
  suggests the next thing to try, never with an apology.
- **Tray** — relief, and the quiet after it. Everything that needed a person has
  had one: a review queue that is caught up, a list of requests with none left.
- **Shoebox** — put away, not thrown out; it keeps until you want it back.
  Shelved courses, saved things, a copy of your own data.

They are named for **what they depict**, never for the screen they landed on —
`Mug` and `Shoebox`, not `EmptyChat` and `ArchiveIcon`. A mark whose name is a
screen gets used once and then nobody dares reuse it.

Marquee empties (a whole screen with nothing on it) get an illustration. The
dozens of small empties inside a room get a Feather icon in a soft ember tile.

Adding one is a real commitment: 96×96 viewBox with air on every side, 2px
round-capped strokes, quadratic curves with a deliberate wobble, no
geometrically perfect circles, exactly two colors (`color` for the strokes,
`softColor` for the one soft blob), and a doc comment naming the mood and the
moment. Ten is plenty. Reach for an existing mood before you draw an eleventh.

---

## 5. Screen anatomy — the house patterns

Every screen that touches data ships all four states. Not three.

1. **Loading** — `ActivityIndicator` in `theme.brand`, centered, or skeleton
   rows when the shape is predictable.
2. **Error, with a retry** — a Feather icon, a warm heading, one sentence
   explaining what happened, and a `soft` "Try again" button that actually
   re-runs the query.
3. **Empty** — an `EmptyState` that recruits or reassures.
4. **Ready** — the real thing.

Plus:

- **Pull-to-refresh on every list.** `RefreshControl` tinted `theme.brand`.
- **Optimistic writes.** The UI moves immediately, the row syncs behind it, and
  on failure it rolls back and a warm inline caption in `theme.danger` explains
  what happened. Never a silent failure; never a modal for a failed toggle.
- **The 44px back chevron.** Top-left, `chevron-left` at 26, with a
  `canGoBack()` fallback to a sensible parent route. Copy the scaffold from
  `mobile/src/app/blocked.tsx` — do not invent a second one.
- **`accessibilityRole` and `accessibilityLabel` on every icon-only
  `Pressable`.** An icon with no label is invisible to a screen reader, and
  roughly a third of this app is icon buttons.

---

## 6. Copy

Huddl sounds like the classmate who has their act together and shares their
notes anyway.

**Warm, not chummy.** Talk *to* students, never at them or down to them. No
forced slang, no "Hey bestie!", no corporate "we're thrilled".

**Specific over clever.** Name the real thing: "Week 5 notes", "your 2pm
discussion section", "everyone in ECS 36A". Never "collaboration", "content",
"engage", "seamless".

**Sentence case.** Everywhere. Buttons, titles, chips, alerts.

**Empty states recruit or reassure.** An empty list is an invitation to be
first, not a dead end.

> "Be the first — add a course and its chat channel opens up for everyone in
> it."
> "You haven't blocked anyone. Hopefully it stays that way."
> ~~"No data found."~~

**Errors explain and offer a way forward.** Say what happened in plain words,
then hand over the next move. Never an error code, never blame the reader,
never a dead end.

> "We couldn't load the calendar. Check your connection and give it another
> go."
> "That check-off didn't save — give it another tap."
> ~~"Error: request failed (500)."~~

**Confirmations name the consequence.** "It comes off the calendar for the
whole class" beats "Are you sure?". Destructive buttons say the verb
("Remove", "Leave"), and the cancel says the outcome ("Keep it").

**Straight about privacy.** Plain sentences, mechanisms not promises. "They
can't DM you, and their posts stay out of sight. They were never told." Nothing
cute about serious things.

---

## 7. The craft floor

Not preferences. The floor.

- **No gradients.** Not on a button, not behind a hero, not in text. Emphasis
  comes from weight, size, and the ember. The v2 gradient signature is retired.
- **No eyebrows, kickers, or all-caps preambles above a heading.** A screen
  title stands on its own. (`SectionLabel` labels a group of rows; it never
  dresses up a title beneath it.)
- **No sparkles, confetti, emoji in UI chrome, or exclamation-point energy.**
  Warmth is not enthusiasm.
- **No grey text on a colored surface.** See §1, rule 3.
- **No raw hex, no pure black/white/grey.** See §1, rules 1 and 2.
- **44px minimum touch target.** Everything tappable. If the drawn thing is
  smaller (a chip, a small link), reach 44 with `hitSlop`.
- **One display title per screen.**
- **Three radii, ten spacing rungs, four durations, three easings, three elevations.** If you need
  one more, you're solving the wrong problem.
- **Every animation gated on `useReducedMotion()`**, landing the final state in
  `motion.instant`. No exceptions. See §3.
- **Both themes, every time.**
- **`react-native`'s `Animated` only.** No new dependencies for motion.
- **Never describe Huddl in terms of another product.** Not in the UI, not in
  onboarding, not in an empty state. It is a campus community platform, full
  stop.

---

## 8. Adding to the system

Before you build a new primitive, answer three questions:

1. **Does it exist?** Three screens hand-rolling the same pill is a `Chip` you
   didn't find.
2. **Will it be used three times?** Twice is a copy-paste. Three times is a
   component.
3. **Can it be described in one sentence in §4?** If the sentence needs an
   "and", it is two components.

New primitives live in `mobile/src/components/ui/`, take every color from
`useTheme()`, carry a JSDoc block naming their *intended use* (not their
props), and get exported from `index.ts` and listed in §4 in the same change.

The point of all of this: a student should be able to move from their calendar
to a club page to a group chat and never once feel like they changed apps. One
hand, one house, one warm room.
