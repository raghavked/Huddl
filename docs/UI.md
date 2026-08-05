# Huddl UI v3 — "hearth" design system reference

v3 "hearth" keeps the huddl brand voice (sentence case, empty states that
recruit — see `BRAND.md`) and re-grounds the visual layer in warmth: cream
paper and espresso ink, an ember primary with clay softs, fern for trust, a
candle-lit dark theme. Soft elevation instead of flat hairline boxes, frosted
glass in the shell, one motion curve everywhere — and no gradients: the v2
gradient signature is retired, along with kickers/eyebrows above headings.

Everything below ships from `src/app/globals.css` and `src/components/ui/`.

Type: `h1`–`h3` render in **Bricolage Grotesque** automatically (see
`globals.css`); the `font-display` utility applies it to non-heading display
text. Body/UI is **Plus Jakarta Sans**; `font-mono` is JetBrains Mono.
Illustrations: `@/components/illustrations` exports warm, hand-drawn,
token-driven SVG scenes (Chat, Calendar, Notes, Huddle, Shield, Discover),
accented with steam curls, crumb dots, and stitch dashes — pass one to
`<EmptyState illustration={…}>` on marquee empty states; route-level loading
states use `Skeleton` / `SkeletonRow` / `SkeletonPage` from `@/components/ui`.

## Tokens

Color tokens carry the hearth palette — cream paper, espresso ink, ember,
clay, fern (see `BRAND.md` §4 for the full hex tables):

- `brand-2` — the warm ember highlight. **Decoration only** (illustration
  accents: steam curls, crumb dots); never a flat UI fill or text color on
  its own.
- `brand-fg` — the text/icon color on `bg-brand` fills (white in light,
  dark espresso in dark — AA in both themes).
- `brand-ink` — readable brand-colored text on soft/neutral fills
  (`bg-brand-soft` chips, active nav, dock labels, unread rows). Use it
  wherever brand *text* sits on a soft fill; `text-brand` is for icons only
  there. Never `text-muted` on a colored surface — secondary text tints
  from the surface hue instead.
- `on-solid` — white foreground for saturated status fills
  (`bg-accent`/`bg-success`/`bg-danger` solids).

New non-color tokens:

| Utility | What it is |
| --- | --- |
| `shadow-soft` | Resting elevation for cards, buttons, pills |
| `shadow-lift` | Hover/floating elevation (docks, popovers, hover cards) |
| `rounded-card` | 1.25rem — the card radius |
| `animate-fade-up` | Entrance for page headers and hero content |
| `animate-fade-in` | Entrance for overlays/panels |
| `animate-scale-in` | Entrance for small popping elements |
| `.glass` | Frosted translucent surface (shell chrome only) |

There are no gradient utilities — `.bg-gradient-brand` and
`.text-gradient-brand` were retired in v3. Emphasis comes from weight and
size, not gradient fills or gradient text.

Browser-drawn surfaces are themed too: `globals.css` sets `caret-color` on
inputs/textareas and a root `accent-color` to the brand token, so text
carets, native checkboxes, radios, and range/progress controls pick up ember
in both themes with no component code.

Theme: light is default; dark applies via system preference or the
`data-theme` override on `<html>` set by `<ThemeToggle />`
(`src/components/theme-toggle.tsx`), persisted as `huddl-theme` in
localStorage. Never branch on theme in components — tokens handle it.

## Primitives (`@/components/ui`)

```tsx
import {
  Button, buttonClasses,      // variants: primary | secondary | soft |
                              //   ghost | danger | danger-ghost
                              // sizes: sm | md | lg | icon
  Card, cardClasses,          // padding: none | sm | md | lg; interactive
  Label, Input, Textarea, Select, Hint, FieldError, controlClasses,
  Badge,                      // tone: brand | accent | neutral | success |
                              //   warning | danger; solid
  PageHeader,                 // title, description?, action?,
                              //   backHref?, backLabel?
  SectionHeader,              // title, href?, linkLabel?
  Segmented,                  // pill link-tabs; items: {href,label,icon?,prefix?}
} from "@/components/ui";
```

- **Links that look like buttons:** `<Link className={buttonClasses({ variant: "primary" })}>`.
- **Cards that are links:** `<Link className={cardClasses({ interactive: true })}>`.
- `Button` renders a real `<button>` (default `type="button"` — pass
  `type="submit"` in forms).

## Layout patterns

- **Page container:** `mx-auto max-w-3xl px-4 py-6 md:py-10` (wide directory /
  browse pages may use `max-w-4xl`). Chat/DM rooms keep their own full-height
  scroll layout.
- **Every page starts with `<PageHeader />`** — title (sentence case),
  optional description, the page's single primary action on the right,
  `backHref` on detail/sub pages. There is no eyebrow prop — kickers above
  headings are banned; the title carries its own weight.
- **Sections** inside a page use `<SectionHeader />` + `mt-8` rhythm.
- **List rows:** `Card` (or `cardClasses({ interactive: true })` on a Link)
  with an icon tile on the left: `flex size-10 items-center justify-center
  rounded-xl bg-brand-soft text-brand` (accent-soft/accent for trust or
  calendar-ish rows). Icon tiles are `rounded-xl`, not circles.
- **Grids of cards:** `grid gap-3 sm:grid-cols-2` (or 3) with `Card
  interactive`.
- **Forms:** stack `<Label>` + control + `<Hint>`/`<FieldError>` with
  `flex flex-col gap-1.5`, groups spaced `gap-5`; submit is `<Button
  type="submit">` with a pending state (`Loader2` + `animate-spin`).
- **Entrance motion:** `PageHeader` animates itself. For the first content
  block on a page, `animate-fade-up` is welcome; don't animate long lists
  item-by-item.

## Shell

- Desktop (`md+`): fixed 16rem sidebar (`src/components/shell/sidebar.tsx`) —
  nav groups "You" / "Campus", unread badge on Notifications, user card +
  `<ThemeToggle />` in the footer. Content area is `md:pl-64`; there is **no
  desktop top bar** — pages own their headers.
- Mobile: frosted `MobileTopBar` (wordmark, campus chip, bell, settings,
  avatar) + floating `MobileDock` pill tabs. Content bottom padding `pb-28`
  clears the dock.

## Rules (unchanged from BRAND.md, restated)

- Tokens only — no raw hex, no grays outside the set. Check both themes.
- One ember primary action per view. Button has no `gradient` variant and
  there are no gradient utilities — hero CTAs use `primary`; emphasis comes
  from weight and size.
- `lucide-react` only, `size-4`/`size-5`, `text-muted` unless meaningful.
- Focus visible on everything interactive
  (`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`).
- Empty states use `<EmptyState />` and recruit; async actions show pending
  state; touch targets ≥ 44px on mobile.
