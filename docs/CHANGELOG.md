# Hearth development log

## Round 18: the adversarial pass over round 17

Migrations 0059 and 0060 live. An eight-agent adversarial review (four
hunting lenses, four verifiers ordered to refute) went over the friends,
status and flagging code, every finding traced end to end before it
counted. Seventeen were confirmed. The theme: round 17 built the features
correctly one user at a time, and several seams between users, and
between features and blocks, were not yet honest.

### Blocks and friendships, redesigned (0059)

0052's absorb-on-insert was itself the tell it tried to prevent: a
blocked ask "succeeded", then reverted to "Add friend" on the next load,
instantly and deterministically, which no human decline reproduces. The
new shape follows 0042's rule all the way down: only the blocker's view
changes. The row stores (the asker keeps an honest "Request sent"
forever, exactly like being ignored); the blocker's select policy hides
any edge with a person they blocked, so their Requests tab and Friends
list arrive pre-filtered; the request notification is skipped for
blocked pairs and throttled to one per pair per day for everyone;
cancelling settles the invitation as read rather than deleting it (a
deleted row would re-arm the throttle, so ask/cancel loops could buzz
forever); and an accept across a block quietly withdraws the request,
minting nothing and telling no one. Presence also stopped ignoring
blocks: no surface shows the viewer a blocked person's "Active now".

### The flag's memory (0060)

A dismissed auto-flag used to suppress every future flag on the same
subject forever; the dedup now counts only open flags, so settling one
re-arms the alarm for the next edit. And flagged club announcements
finally point at themselves: reports grew `club_announcement_id`, the
moderation queue names them, and `reported_content()` hands triage the
words like it does for a DM.

### Client truthfulness

Optimistic state machines learned to re-derive the truth on failure
instead of restoring a snapshot the server no longer agrees with; every
action button now disables while any write is in flight instead of
silently swallowing taps; the mobile remove-friend dialog stopped
clobbering fresh data with its render-time closure; the presence
heartbeat's throttle resets when the signed-in user changes; the web
profile page's presence line moved into a client component so "Active
today" uses the viewer's midnight, not the server's; and Friend requests
gained the push toggle the settings screens promise every buzzing kind
has.

## Round 17: friends, status, the smoke alarm, and the fleet

Migrations 0050 to 0057 live. Two features the schema had always talked
around, one safety system, and then a simulated student body was let loose
on the whole app under real row-level security to prove every feature works
between users, not just for one.

### Friends and status

- **Friendships** (0050, 0052): one edge per pair, asked by one side and
  answered by the other. Declining is deleting, with no tombstone, so being
  turned down is indistinguishable from being quietly ignored. Same campus
  only. A request across a block is absorbed silently by a definer trigger,
  because a refused insert would be a tell and blocks are never told.
  Notifications ride the new `friend` kind. Both clients grew the same
  controls, word for word: the profile button (Add friend / Request sent /
  Accept request / Friends), and a Friends screen with Requests, Sent and
  Friends sections.
- **Status** (0050): `profiles.last_seen_at`, written only by
  `touch_last_seen()` (throttled, server-clocked, never client-supplied),
  rendered as "Active now" / "Active recently" / "Active today", never a raw
  timestamp. The "Share when you're active" toggle does not hide the fact,
  it erases it: flipping it off nulls the column in the same statement and
  the touch function goes silent while it is off.

### Slurs flag themselves

The report system waited for a student to press the button, which is right
for everything except the one category with no innocent reading. Now (0051)
a lexicon of slurs, in a deny-all table the API can neither read nor
enumerate, is checked by trigger on every communication surface: channel
messages, DMs, board posts, club announcements, and profile text. A hit
files an ordinary report with no reporter: moderators see "Hearth flagged
this automatically" in the same queue, students never see it, the rate
limiter never counts it. Nothing is blocked or hidden; the message sends
and a human is summoned. Swearing is deliberately not in the lexicon and
trips nothing, ever. Matching folds the disguises people actually type
(digit swaps, symbol swaps, censoring asterisks, plurals) and leaves
"conspicuous", "Nigeria" and "coonhound" alone.

### What the fleet found

Twelve simulated students signed up through the real trigger on an isolated
simulation campus and ran 117 checks over every feature as authenticated
users under RLS: profiles, presence, friends, blocks mid-conversation, DMs
and group threads, rate limits, rooms, reactions, pins, polls, courses,
grades privacy, notes, decks, buddies, clubs, events, the board, reports,
the auto-flag, triage, focus, notifications, export, search, and account
deletion. Everything they touched was purged afterwards; the database ends
the round exactly as it began, plus the lexicon. Four real defects
surfaced and were fixed on the spot:

- **Friend requests were impossible** (0052): 0050's insert policy called
  `is_blocked_either()`, which 0037 had made uncallable by the API role.
  The fleet's very first request found it.
- **Account deletion had been broken in production** (0054): Supabase's
  storage guard now refuses direct SQL deletes, so `delete_own_account()`
  raised instead of deleting. It opts in through the sanctioned
  transaction-local setting now. This one predates the round entirely.
- **Moderators could not see automatic flags** (0055, 0056): the queue's
  campus scoping ran through the reporter's profile, and an automatic flag
  has no reporter. Both the policies and `reported_content()` now anchor a
  null-reporter row to the flagged author's campus.
- **Plural slurs slipped past** (0051, amended before shipping):
  "trannies" sailed by "tranny(s|es)?". The matcher now takes y/ies
  endings, and "chinky" earned its own lexicon entry.

## Round 16: rooms that look like ours, and twelve hearths

No schema this round; it went on identity. Rooms stopped dressing like
Discord: the `#` and channel furniture gave way to a room identity system
(glyphs by kind, typed names over slugs, warm monograms), word-identical
across both clients and pinned by a parity test. And Look and feel grew
twelve colour schemes: Ember plus eleven re-litings of it, generated from
one recipe (`scripts/schemes.py`) that proves the same WCAG pairs in both
appearances for every scheme, from Aggie blue-and-gold to hot pink Peony,
with the loud ones loud and Slate deliberately quiet.

## Round 15: keeping the promises, and saying them plainly

Migrations 0041 to 0048 live. No new surface this round. It went instead on
the two things a social app is actually judged on: whether the safety
guarantees hold when someone leans on them, and whether the words on screen
are true.

### The promises, checked against the database

The round started as a bug hunt and turned into an audit, because several of
the things students are told about privacy were enforced in the client and
nowhere else.

- **A block is now a database fact** (0042). `i_blocked()` plus a `dm_messages`
  SELECT policy drops rows authored by anyone the reader blocked. Deliberately
  one-way, and deliberately does not refuse the blocked person's INSERT: they
  are never told. Blocked classmates also stopped appearing on the front door
  and on the native course roster.
- **Three privileges row-level security cannot restrain** (0043), revoked from
  `anon` and `authenticated`: TRUNCATE, REFERENCES and TRIGGER. RLS does not
  filter TRUNCATE. A policy that carefully limits what a student can DELETE is
  worth nothing next to a grant that lets them empty the table.
- **Storage buckets got the limits the clients only pretended to enforce**
  (0044): sizes, and a raster allow-list that excludes `image/svg+xml`,
  because an SVG served from a public bucket is a script.
- **The UPDATE path closed around 0041** (0045). The forwarded-attachment
  trigger added in 0041 fired on INSERT while a table-wide UPDATE grant sat
  next to it, so the check could be walked around in two statements instead of
  one. That is a hole in the previous round's own work.
- **Coursework caught up with chat photos** (0046). 0039 gated the storage
  path for chat uploads, and the identical gap in notes was never closed.
- **The phone badge is gone** (0047). Twilio is out of the codebase entirely.
  A student earns the verified badge with a confirmed university email and a
  profile with something in it: a real name that is not just their handle, a
  photo, a major, a year. `verified_at` sits outside the UPDATE grant, so it
  cannot be self-awarded, and the client explains which half is missing rather
  than leaving someone to guess what "verified" wants from them.
- **Two gaps in 0047, found by the database linter** (0048). A trigger
  function left executable over REST, and the one function of the four whose
  `search_path` was not pinned. Neither exploitable alone; both the kind of
  omission only a tool finds, which is the argument for running the tool.

The web app spent the round catching up to the phone on all of this: the block
list, `is_public` redaction, reporting that actually files a report, and a
privacy policy that had been telling students a block stops someone seeing
their posts, which was never true.

### Saying it plainly

- **Every em dash is gone**: 4,012 of them across 351 files. The character was
  doing real work, and the work was avoidance. It stood in for the decision
  between "this is one sentence" and "this is two", and every string in the
  app got to skip that decision. Each one was replaced by what the sentence
  wanted: a full stop, a colon, brackets, or nothing. Never a hyphen. The
  marketing register went with it.
  - One survives as an escape, in the flashcard paste separator, because
    students paste `front - back` lines and one of the dashes they use is that
    one. It is data, not prose.
  - Applied migrations keep theirs. `supabase/migrations` records what was run
    against the database, and editing it to tidy comments would trade a real
    property for a cosmetic one. `no-em-dashes.test.ts` enforces the rule
    everywhere else and documents the exemption.
- **"How Hearth works"**, on both clients, from one shared module with a test
  keeping the copies byte-identical. The welcome tour runs once on first
  launch, and nothing explained the app to a student in week three who wanted
  to know who could see their grades. Writing it turned up two claims that
  would have been false, both corrected: turning off Public profile does not
  remove you from the people directory, and the directory is searched rather
  than filtered.
- **The two clients stopped disagreeing.** A scan of every sentence in both
  found five that had drifted a word or two apart and two that had drifted
  into being wrong. Mobile claimed the moderation queue shows "who decided
  it"; `reports` stores no such thing. The web privacy page omitted "and
  notify" from the typing-indicator explanation, which is the exact
  reassurance someone toggling it is looking for.
  - The validation limits had drifted too. Twenty-eight named constants agree
    perfectly across both clients; the only two that did not were the two
    written as bare inline numbers. Channel names capped at 40 on mobile
    against 80 on the web, descriptions 200 against 500, club names 60 against
    80. All three converge on the wider value, since nothing in the database
    constrains them and no existing row should become uneditable.
  - `copy-parity.test.ts` keeps it that way: sentences at least 95% alike
    across the clients but not identical fail, with the four genuine idiom
    pairs listed (a phone is tapped, a browser is clicked).

### A note on how the em dash sweep actually went

The first pass reported 12 of 12 agents clean, and had covered 65% of the
codebase. The partition script computed each agent's file list by scanning for
files that currently contained an em dash, so as agents removed them the file
set shrank and the bins reshuffled under whoever ran the script next. Every
agent truthfully reported zero remaining for the list it happened to see.

The fix was to freeze the partition to a static file, and to key a module, its
test and its mobile/web twin into the same bin. The second half was not
optional: eleven strings could not be touched in the first pass because a test
in another agent's group asserted them exactly.

Verified at the end of the round: 361 tests, web and native `tsc`, web
`eslint`, the production Next build and the iOS Hermes bundle all green. Zero
em dashes outside `supabase/migrations`. 247 of 256 native `Pressable`s carry
an accessibility label or role, and the nine that do not are deliberate and
commented: message bubbles that let the screen reader read the message itself,
and cards marked `accessible={false}` so their inner buttons stay individually
reachable. `expo lint` does not run and never has, because there is no eslint
config under `mobile/`.

Left for someone with dashboard access: leaked password protection is off in
Supabase Auth, and no migration can reach it.

## Round 14: the board, the term, and the quiet parts

A planned slate of 24 updates, migrations 0032–0036 live, run as five waves of
agents with strictly disjoint file ownership. The theme, in hindsight, is the
app growing outward from "your classes" into "your campus and your term",
plus the platform work that makes living in it bearable.

### The campus board

- **Seven boards, one table**: rides home for break, lost, found, free, for
  sale, asks and offers. Campus-scoped, author-owned, and **closable rather
  than deletable**. A post that got what it wanted stays readable, greyed, at
  the bottom, because a board nobody tidied should still read as a live board.
  Stale posts (a ride whose day has gone, anything over 30 days) sink under
  fresh ones without disappearing.
- Money is whole cents everywhere and never a float: `priceCentsFrom` exists
  because `45.50 * 100` is `4550.000000000001` in JavaScript and the column
  has a check constraint. The date-only `happens_on` column is read with
  `parseBoardDay` for the same reason in the other direction. `new Date` on
  a date string lands on UTC midnight, which is the previous afternoon in
  California, and every ride would read as leaving a day early.
- Board posts are reportable like any other content, with `reports.board_post_id`
  and a rewritten subject constraint behind it.

### The term

- **Semester overview**: the whole quarter on one screen with a GPA estimate
  that is **honest about its own footing**: units are all-or-nothing, so if a
  single graded class is missing them the figure is a plain average and says
  so, naming the classes responsible. Inventing a default of 4 units would
  produce a number that looks weighted and isn't.
- **Weekly series**: one entry for the lab that meets every Tuesday, expanded
  across the term and editable as a set (`course_calendar_items.series_id`).
- **Per-item reminders**: your own lead time on any due date, 15 minutes to
  two weeks, on an hourly sweep.
- **Course colours**: six tints on the enrollment, carried across calendar,
  plan and hubs, so a glance tells you which class.
- **Note tags**: up to five per note, normalized by a trigger rather than
  rejected by a constraint, so a student who types `"Midterm "` gets `midterm`
  instead of an error.

### Chat

- **Forwarding**: pass a message into another room or a DM with the original
  author still credited. `forwarded_author_id` and `forwarded_from` are
  denormalized onto both message tables precisely so a channel message can
  forward into a DM and keep its attribution.
- **Availability polls**: propose a few times, everyone taps what works.
  Rendered as a pinned strip above the composer rather than inline, because
  `messages` has no poll foreign key and text-matching the announcing message
  would graft a live poll onto anyone who happened to type the same sentence.
- **Offline drafts and a send queue**: a draft survives leaving the room, and
  a message sent with no signal queues and goes out when there is one.

### The quiet parts

- **Quiet hours**: a window per student, honoured by the push trigger, which
  moved to BEFORE INSERT so it can defer rather than send. The in-app inbox is
  never affected; a deferred notification arrives with the next digest.
- **A real push digest**: a second notification inside two minutes of the
  last one is deferred instead of buzzing again, and a five-minute sweep sends
  **one** push describing the pile. A busy channel stops meaning twelve buzzes.
- **Reciprocal privacy toggles**: turn off read receipts or typing indicators
  and you stop seeing other people's too. The reciprocal version is the only
  honest one, and it's documented on the columns.
- **Data export**: `export_my_data()` returns everything Hearth holds that's
  yours as one JSON document. It's the other half of the deletion promise.
- **A moderation queue**: `/moderation`, open / reviewed / dismissed with the
  reported content in place. `is_moderator` is enforced by a **column-scoped
  update grant**: the `authenticated` role's grant on `profiles` simply does
  not include the column, so no account can promote itself no matter what it
  sends.
- **Richer profiles**: interests you can filter the people directory by, and
  a line about what you're looking for.
- **Sunday recap**, deep links with real `.well-known` files, schedule paste,
  recent searches.

### Migration 0036: what an advisor sweep found

- `update_course_details` had grown a **second live signature**. 0032 added a
  five-argument version for the new units column without dropping the
  four-argument one, and every caller in both clients still sent four keys.
  The new overload had never once run, and `units` had no writer at all.
  The trap was for whoever tidied it up: the five-argument body sets
  `units = p_units` unconditionally with `p_units` defaulting to null, so
  dropping the *old* overload would have made a student fixing a room number
  silently erase that course's units for the whole class, and the semester GPA
  would have quietly stopped being weighted. Dropped the overload instead and
  gave units their own RPC, where null clears **on purpose** rather than by
  omission.
- Two tables were evaluating two permissive SELECT policies on every read:
  `reports` (0034 added the moderator policy beside the reporter one) and
  `event_rsvps` (a FOR ALL policy answering reads alongside the visibility
  one). Merged each into one read policy with identical visibility.
- Thirteen foreign keys had no covering index. Four are on live read paths;
  the rest only matter on cascade delete, which is "delete my account", the
  one operation that must not time out.

### Every new surface gets a front door

The last wave shipped a lot of screens that nothing linked to. Settings gained
Privacy, Your data, and a Reports row that exists only for moderators.
Unknown renders nothing, so there is no flash of a row that then vanishes, and
a failed check reads as "not a moderator" rather than as an error. The course
hub gained Notes and Weekly pattern, rewoven to eight tiles that keep both the
checkerboard and the meaning-driven tones. Courses gained a quiet link to the
term overview, and Home gained a board card that swallows its own failure.

`/report` finally accepts a board post. The board detail screen had been
passing `boardPostId` since it shipped and the column had existed since 0034;
the screen just never read either.

### Craft and platform

- **Five more hand-drawn marks**, bringing the set to ten: a pinned note for
  the empty board, a wall calendar for the term, a hand lens for a search that
  found nothing, an empty desk tray for a clear report queue, a shoebox for
  things put away. Drawn in the house style: 2px round-capped strokes,
  wobbling quadratics, no geometric-perfect circles. Three were redrawn after
  the paths were rasterized and checked side by side: the lens specks had
  arranged themselves into a smiley face, the tray read as a bowl on legs, and
  the shoebox tapered like a bucket.
- **Motion grew a house curve.** Three easings on the `motion` tokens
  (`standard` for anything reversible, `enter` for arrivals, `exit` for
  departures), so no screen has to reach for `Easing` and invent a fourth.
  Button's press became asymmetric (quick down, slower back up, which is what
  pressing something soft actually feels like), Card gained an opt-in staggered
  entrance frozen at mount so a re-sort can't replay it, and Chip acknowledges
  selection with a swell rather than only a colour change. Every one gated on
  `useReducedMotion()`. Skeleton deliberately did *not* become always-pulsing:
  §4 of this design language calls for a still block, and the conflict was
  flagged rather than silently overridden.
- **`Sheet.Row` learned `selected`**, which draws the trailing check *and* sets
  `accessibilityState`, the half that matters, since the hand-drawn checkmarks
  it replaces were invisible to VoiceOver. Backward compatible across all 30
  call sites.
- **An accessibility pass over every screen**: verb-first labels on every
  pressable, so an icon-only button stops being invisible; `accessibilityState`
  on everything selectable, including the switch rows that are meaningless
  without it; words for anything carried only by colour; composite rows (a
  person, a notification, a saved message) reading as one item with one full
  label instead of six fragments; and live regions where counts change under
  the cursor, so a reader hears "8 results" instead of silence.
- **Forwarding de-duplicated.** The first pass wrote the same 482 lines into
  three room screens (byte-identical, verified by diff) because the agent
  owned only existing files and could not create a shared module. Now
  `src/features/forwarding/` holds it once and the three rooms drop from 7,583
  lines to 6,110. The hand-rolled search input inside the picker became the
  `Field` primitive, shown only once a student has more rooms than fit on
  screen.
- **Web parity** for the whole slate: board, semester, series, reminders,
  tags, colours, interests, moderation, quiet hours, export. Plus 120 new
  tests, taking the suite from 176 to 296.
- **Docs**: the operations playbook finally documents the five `pg_cron` jobs
  that have been running in production undocumented, and how to tell a
  deferred notification from a broken pipeline.
- **A device loop.** `expo-dev-client` plus `npm run device`, which builds and
  installs to an iPhone over the cable, and a runbook covering the one-time
  Xcode and Developer Mode setup, native log tailing, the three things only a
  real device can test (push, camera, haptics), and the failures that actually
  happen. The README now says plainly that Expo Go cannot run this app, since
  three native modules and push all need a real build, rather than leaving it
  to be discovered.

Verified at the end of the round: native `tsc` clean and the iOS Hermes bundle
exporting at 4.9MB; web `tsc`, `eslint`, 301 tests and the production build all
green. Independently of what any agent reported: zero raw hex outside the
theme, zero `theme.text`, zero gradients, ten illustrations exported, and all
four animated primitives gating on reduced motion.

## Round 13: the big slate of design language, groups, focus, and grades

Migrations 0028–0029 live, 25 agents in three waves: schema first, then the
features, then the integration pass and the web port:

- **Design system v3.1**: elevation and motion token families (warm shadow
  ink pulled from the palette; dark leans on surface contrast instead of
  shadow) and five new primitives: **Chip**, **EmptyState**,
  **SectionLabel**, **Sheet** (+ `Sheet.Row`), **Skeleton**. Each one
  normalizes a pattern roughly 26 screens had been hand-rolling. Button
  gained a physical press (0.98 scale, reduced-motion aware), Card took the
  elevation tokens, and `docs/DESIGN.md` is the language written down:
  palette, type, spacing, elevation, motion, copy voice, craft floor. Nine
  existing screens then moved onto the primitives: Sheet replaced four
  hand-rolled action sheets in the chat surfaces alone (net −418 lines
  there), Chip replaced five local pill components, EmptyState /
  SectionLabel / Skeleton took the rest. Five cases were left alone on
  purpose, with the reasons written down next to them.
- **Display preferences**: theme mode (system / light / dark) and a clamped
  text scale, persisted to AsyncStorage by a DisplayProvider mounted above
  everything; `useTheme` and `AppText` read from it, so all ~50 screens
  re-theme and re-scale without being touched. `/display-settings` shows
  live theme previews and a live type sample rather than describing them.
- **Group DMs**: start a thread with several classmates at once. A campus
  people picker in the `/dm/new` composer, a `/dm/info` roster where anyone
  can rename the thread, add someone, or leave. Group-aware headers and
  author names in the room, avatar clusters on the Messages list, and a
  `threadDisplay` rule so an untitled group still reads like its people.
  Built on the 0028 RPCs, with `create_dm_thread` now excluding groups so
  1:1 find-or-create can never hand one back.
- **Focus sessions**: `/focus`, with goal chips, an optional course, and a timer
  that ticks only while the screen is focused, over a data layer whose math
  (elapsed, remaining, progress, duration formatting, streak) is pure and
  takes `now` as an argument. Open rows are the campus "studying now" list
  over realtime, so nobody is grinding alone at 11pm; closed rows are the
  quiet history behind the streak. `FocusStrip` is the embeddable version.
- **Private grade tracker**: weighted categories off your syllabus, the
  scores inside them, and a course estimate rescaled by the weight actually
  graded, so an early-quarter student isn't dragged to zero by empty
  buckets. What-if targets ("what you need on the final"), letters, and a
  warning when the weights don't add up. The 0028 tables are self-only, and
  the screen says so once, plainly, then gets out of the way.
- **Club announcements**: an officer-guarded composer that explains the
  reach before you write, an announcements section on the club home with
  bylines that survive a deleted account, and a new `club_post` notification
  kind with a block-aware trigger. The data layer's two pure helpers mirror
  the RLS policies, so the button and the empty state can never disagree
  about who may post.
- **Study buddies**: opt in per course with a note about how you study, see
  the classmates who did the same, message one in a tap. Opting out is a
  delete (nothing lingers) and the screen says so.
- **Course archiving**: long-press to shelve a finished class (its chat and
  notes stay exactly where they are), plus an archived shelf grouped by
  term, collapsed until asked for. Migration **0029** adds the UPDATE policy
  0028 forgot: a column-scoped grant so a student may change `archived_at`
  on their own enrollment and nothing else; role and source stay out of
  reach. Without it every archive failed the RLS check; an agent caught it
  while porting the feature to web.
- **First run**: a three-panel welcome drawn on the hand-drawn marks (what
  classes do, what a syllabus turns into, who's on the other side of a
  message), then a live starter checklist that re-reads on focus, so
  progress ticks over as it happens instead of after a reload.
- **Integration**: the course home is a six-doorway grid now (Calendar,
  Rooms, Flashcards, Links, Grades, Study partners) with tones assigned by
  meaning rather than alternation (fern for the dated and filed, ember for
  people and studying), plus a FocusStrip that stays invisible until a
  classmate is actually studying. The shell learned Look and feel, Focus,
  and a way back to the welcome; Home shows active courses only and carries
  its own focus strip; the plan and calendar stopped fanning out to shelved
  courses; and the launch gate routes first-timers through `/welcome` once.
- **Web parity**: group DMs end to end (composer, stacked-avatar thread
  rows, a group-aware room with a roster panel that renames, adds and
  leaves); focus sessions, study buddies and club announcements ported with
  their data layers; the private grade tracker with 41 new tests; course
  shelving via server actions; and `/settings/appearance` owning both theme
  and text size, replayed before first paint from the root layout.

Verification: mobile strict tsc + iOS Hermes export (4.5 MB); web tsc,
ESLint, 176 Vitest tests, production build with every new route.

## Round 12: design pass, saved messages, and event reminders

Migration 0027 live, seven agents (three were interrupted mid-flight by a
model credit cutoff and finished on the next pass):

- **Home redesign**: a date eyebrow over a time-aware greeting
  ("Morning, Alex"), a **Today strip** that appears only when today
  actually holds something ("2 due · PHYS 9B review tonight", composed
  from data already fetched, no new queries), normalized 24/12 section
  rhythm, a "Calendar" action on Coming up, ghost-block loading, and one
  calm 240 ms fade-up on first data that respects reduced motion.
- **Course home redesign**: the stacked doorway cards collapse into a
  2×2 tile grid (Calendar / Rooms / Flashcards / Links), each tile
  carrying live context: the next due title, the pinned-link count.
  Every capability survives; links moved one tap deeper.
- **Flashcard flip**: a real 3D turn. Two stacked faces on one
  `Animated.Value`, `rotateY` 0→180 against 180→360 with `perspective`
  and `backfaceVisibility`, 320 ms cubic easing on the native driver,
  instant when reduced motion is on. The shell sizes to the taller face
  so the card never reflows mid-flip.
- **Paste-import for decks**: paste a study guide, get cards. The first
  separator of dash / em-dash / colon / tab wins, oversize and
  unsplittable lines skipped, duplicate fronts deduped case-insensitively,
  live "{n} cards ready · {m} lines skipped", one bulk insert.
- **Saved messages**: private bookmarks on any channel or DM message via
  the long-press menu, and a `/saved` shelf that reads them back with
  author, context chip, mention highlighting, and a tap through to the
  room. Bookmarks whose message you can no longer see (a channel you
  left, a message its author deleted) drop out silently.
- **Event reminders**: an hourly pg_cron sweep nudges everyone who
  RSVP'd "going" about an hour out ("Starting soon: PHYS 9B review ·
  7:00 pm · Shields 218. See you there."), deduped per student per
  event, riding the normal inbox + push pipeline.

Verification: mobile strict tsc + iOS Hermes export (4.2 MB); web tsc,
ESLint, 114 Vitest tests, production build with the /saved route.

## Round 11, the hearth round: your calendar, thanks, and the vibe audit

Migration 0026 live, five agents:

- **Your calendar**: one month view merging every class due date with the
  events you've RSVP'd (and your courses' events): Monday-start grid,
  ember dots for class dates, fern dots for events, today in clay, an
  agenda for the selected day with in-place check-offs. Both clients;
  entry from the Events header.
- **Note thanks**: a heart on every shared note. One tap per classmate,
  retractable, and the uploader's inbox warms up ("Maya said thanks for
  your notes. 'Week 4' in MAT 21A just made someone's week."), delivered
  by a block-aware trigger that skips self-thanks. Both clients, with a
  'thanks' notification kind end to end.
- **Hand-drawn illustrations**: a five-mark stroke library (Mug, Doorway,
  PaperPlane, Pennant, Lantern; quadratic wobble, no perfect circles,
  theme-token colors only) now warming the empty states of home,
  channels, messages, clubs, search, and the blocked list.
- **The hearth audit**: all 33 remaining native screens swept. Raw hex
  literals normalized to theme tokens (photo viewers now use the
  candle-dark pattern), cold copy warmed ("Cancel" pairs became "Keep
  it" / "Never mind" / "Stay", "Profile not found" became "Nobody's
  here"), sub-44px targets fixed, radius literals tokenized; 22 screens
  verified already clean. Web audit of auth/settings/DM surfaces: one
  raw-error leak fixed, everything else already on tokens.

Verification: mobile strict tsc + iOS Hermes export; web tsc, ESLint,
114 Vitest tests, production build with the /calendar route.

## Round 10: study tools, course depth, and the feel pass

Migrations 0024–0025 live, five agents across both clients:

- **Flashcards**: shared decks per course. Any classmate adds cards,
  authors edit their own, deck creators curate; a three-button
  spaced-repetition study mode (`again` 10 min · `good` 1/3/7/14/30 days
  · `easy` 3/7/14/30/60, streak-indexed, pure `srs.ts` lib ported to
  both clients with 19 tests) with private per-student review state,
  interval previews on the grade buttons, and save-before-advance so
  leaving mid-session loses nothing.
- **Course depth**: classmate-edited course details (instructor, meeting
  times, location via an enrollment-guarded RPC, "kept up by the class")
  and pinned course links (syllabus, textbook, office hours; http(s)
  validated, author-removable) on the course home in both clients.
- **Notification control**: per-kind push toggles (DMs, mentions,
  replies, class calendar, events, digest) writing
  `profiles.notification_prefs`; the push trigger honors opt-outs while
  the in-app inbox keeps everything. A pg_cron **weekly digest** lands
  Monday morning with the week's due-date count, deep-linking to /plan.
- **The feel pass**: haptics at moments of completion (check-offs,
  sends, reactions, pins, tab presses) behind a web-safe wrapper; a
  no-guilt study streak chip on the plan (consecutive check-off days,
  hidden below 2); accessibility sweep of the touched screens
  (checkbox roles + states, labeled icon buttons).

Verification: mobile strict tsc + iOS Hermes export; web tsc, ESLint,
114 Vitest tests, production build with the new deck and
notification-settings routes. Security advisors re-run after 0024:
clean (only the documented accepted items).

## Round 9: discovery, depth, and App Store readiness

The mobile-readiness round:

- **Campus discovery**: a global `/search` screen (people, channels,
  courses, clubs, events in one debounced query fan), a campus channel
  directory with join-in-place, and topic-channel creation, all native.
- **Clubs grow up on native**: full club homes (roster with roles,
  upcoming events, join/leave, open chat), club founding with the web's
  exact trigger-backed semantics, and club-linked event creation that
  announces itself in the club chat.
- **Unread state**: channel unread dots on the Channels tab and Home
  (latest message vs `last_read_at`, never for muted or own messages),
  long-press mute per channel, and mark-as-read stamped by the room on
  focus and blur.
- **Finishing flows**: in-room message search, creator event editing and
  cancellation, and onboarding now hands off to "add your classes".
- **App Store packaging**: hearth-branded icon/splash/adaptive/monochrome/
  favicon/notification assets generated from the Bricolage wordmark (the
  "h." mark, ember + cream); app.json with photo/camera permission
  strings, brand splash colors in both themes, build numbers, and the
  encryption-exempt flag; eas.json build profiles; docs/APP_STORE.md
  with listing copy, age-rating guidance, review notes, screenshot plan,
  and the pre-submission checklist; template Expo assets removed.

Verification: mobile strict tsc clean and full iOS Hermes export; web
tsc/tests untouched and still green (95).

## Round 8: chat power, trust, and the legal layer

Nine agents over four live migrations (0019–0022, plus the 0023
performance sweep):

- **Chat power, both clients**: image attachments in channels and DMs
  (private `chat-uploads` bucket, signed URLs, lightbox/full-screen
  viewers), polls that live in the message stream (single vote, live
  results over realtime, creator close), @mentions with composer
  autocomplete + server-trigger notifications, pinned messages (any
  member, via RPC), and message edit/delete on native.
- **Device push**: `push_tokens` per device; a pg_net trigger fans every
  notification row out to Expo's push API. Native registers on sign-in,
  routes notification taps by link, and has a push-settings screen.
- **Safety**: blocking end to end (server-guarded DMs, muted
  notifications, client filtering everywhere, blocked-people list),
  categorized reporting (8 categories, 24-hour review promise),
  server-side rate limits (30 messages/min, 10 reports/hour), and
  in-app account deletion (`delete_own_account`, storage swept).
- **Legal**: Terms of Service, Privacy Policy, and Community Guidelines
  written for Hearth specifically, rendered in both clients from one
  content source, linked at signup, acceptance stamped at onboarding
  (`accepted_terms_at`); docs/LEGAL.md tracks the attorney-review
  checklist.
- **Events grow up**: native event creation (study session / meetup,
  optional course link), course homes list upcoming study sessions and
  announce new ones in the course chat; profile photos upload to the
  avatars bucket with a shared Avatar component.
- **Web parity**: rooms, class calendar, syllabus import, and the study
  plan as web pages (ported pure libs + 28 new tests); attachments,
  polls, mentions, pins, and block filtering in web chat.
- **Security/perf sweep**: trigger functions revoked off the RPC surface,
  all 53 RLS policies rewritten to evaluate `auth.uid()` once per
  statement, hot-path FK indexes added. Remaining advisor item for the
  dashboard: enable leaked-password protection (Auth setting).

Verification: mobile strict tsc + iOS Hermes export (3.8 MB); web tsc,
ESLint, 95 Vitest tests, production build with the new
rooms/calendar/syllabus/plan/legal routes.

## Round 7: the study layer, and courses become homes

Two fleets on top of a live-backend round (migrations 0016–0018 applied
to production Supabase):

- **User-managed courses with catalog autocomplete**: `catalog_courses` /
  `catalog_offerings` seeded with 95 real UC Davis courses (142 term
  rows) from the registrar/catalog sources; `search_catalog` typeahead
  and a relaxed `enroll_from_catalog`. The catalog suggests, it never
  gates. Students add, edit, and drop courses entirely themselves; the
  Canvas connector and schedule-photo OCR are deleted from the web app
  (routes, features, API, tesseract.js dependency), and all product copy
  is rewritten for the user-owned model.
- **Course rooms**: many channels per course via `channels.is_main` and
  the `create_course_room` RPC: Lectures, Discussion, Study group,
  Notes, or custom rooms; the native Channels tab groups rooms under
  their course, and every course home has a Rooms doorway.
- **Class calendar + syllabus import**: shared `course_calendar_items`
  (RLS-scoped to classmates) with an on-device syllabus parser
  (`mobile/src/lib/syllabus.ts`): paste text, preview and edit the
  found dates, land them in one batch; only an item-count audit row is
  stored. Hand-added exams/due dates notify every classmate via a
  database trigger.
- **Study plan**: private `study_checkoffs` over the shared calendars;
  `/plan` groups Overdue / Today / Tomorrow / This week / Later, adds
  recommended study blocks 7/3/1 days before exams, and a plan card on
  Home always knows what's next.
- **Notifications center**: `/notifications` with realtime inserts,
  mark-read + deep links, unread bell badge on Home backed by a
  head-only count hook.

Verification: mobile strict tsc clean, iOS Hermes export (3.5 MB); web
tsc/ESLint clean, 39 Vitest tests, production build (Canvas/schedule
routes gone). Root ESLint now ignores `mobile/` (own toolchain), matching
the root tsconfig exclude.

## Round 6: native app (App Store track)

New `mobile/` Expo app (SDK 57, expo-router, TypeScript strict) sharing
the same Supabase backend: hearth tokens and fonts ported natively,
AsyncStorage-persisted auth, five-tab shell, and real screens: home
feed, channels + realtime chat room with optimistic sends, messages +
DM room with unread dots, clubs with join, events with RSVP, settings
with sign-out. Verified by full iOS Hermes bundle export. App identity
app.uhearth.mobile; EAS build/submit are the remaining user-side steps.

## Round 5: mobile-exclusive

Hearth is a mobile app, full stop: the desktop sidebar is gone, every
viewport gets the phone shell, and on larger screens the app renders as a
centered phone-width column with soft edges. Chat/DM room heights and
loading ghosts follow the single-shell math.

## Round 4 fleet: live-feeling features

- **Typing indicators** in channels and DMs (Realtime broadcast, throttled,
  TTL-pruned, layout-stable) and **presence** (online dot on the DM header).
- **In-channel message search**: header trigger + inline panel, debounced
  ilike query scoped by RLS, escaped metacharacters.
- **Content reporting**: `reports` table (migration 0015, reporter-scoped
  RLS, service-role triage), server action, and a Report action with a
  two-tap reason picker on others' messages.
- **Add to calendar**: RFC 5545 `.ics` route (escaping, UTC, line folding)
  plus a quiet secondary button on the event page.

A running record of the major development rounds on the
`claude/hearth-ui-development` line. Verification for every round: TypeScript
strict, ESLint, the Vitest suite, and a production build; visual rounds also
ship rendered screenshots in both themes.

## v3, "hearth" (current)

The homey revision, guided by impeccable's craft-floor rules and the
ui-ux-pro-max checklists (both vendored from source and applied by hand):

- **Palette**: warm cream paper + espresso ink, ember/terracotta primary
  with clay softs, fern accent, candle-lit dark theme (warm browns, not
  blue-black). Every pair AA-checked in both themes.
- **De-AI pass**: gradient text and gradient utilities retired; the
  eyebrow/kicker pattern removed app-wide (PageHeader no longer has the
  prop); sparkle motifs replaced with hand-drawn steam curls, crumb dots,
  and stitch dashes; no gray text on colored surfaces (unread rows tint
  from the surface hue); browser surfaces themed (caret-color,
  accent-color, scrollbars, selection).
- **Landing**: gradient hero replaced with a hand-drawn ember underline;
  section kickers deleted; closing CTA is one calm ember panel.

## Round 3 fleet: features

- **Cmd+K quick switcher** (`src/features/search`): navigate anywhere,
  jump to your channels, find campus people; full combobox semantics.
- **Unread DM badges**: `unread_dm_thread_count()` RPC (migration 0014,
  security-invoker, hardened) feeding the sidebar badge and dock dot.
- **SEO & sharing**: robots, sitemap, OpenGraph/Twitter card images via
  `next/og`, `metadataBase` + social metadata.
- **Tests**: 51 → 80 (time-format branches under fake timers, file-size
  seams, phone normalization, avatar tone determinism).
- **A11y**: audit + 16 files of attribute-level fixes (role=log feeds,
  named form landmarks, live regions, honest disclosure semantics).

## Round 2 fleet: app surfaces

- Branded 404, client error boundary, dependency-free global-error.
- 15 route-level `loading.tsx` skeletons mirroring real layouts
  (chat/DM ghosts replicate the full-height composition exactly).
- Illustration scenes wired into seven marquee empty states.

## v2 → v2.1: UI system

- Design tokens with soft elevation, motion, and glass; component library
  (`src/components/ui/`); all-new shell (desktop sidebar, mobile glass
  top bar + floating dock); theme toggle (light/system/dark, no-flash
  boot, browser-chrome sync); every screen reskinned on the primitives.
- Type system: Bricolage Grotesque display over Plus Jakarta Sans body
  (open-source via `next/font`), which surfaced and fixed a latent bug
  where body text silently fell back to system fonts.
- Contrast + consistency audit rounds with computed WCAG ratios.

## Backend

- Live Supabase project (all 14 migrations applied, seeded demo campus).
- Demo login for previews: `alex.rivera@ucdavis.edu` / `hearth-demo-2026`.
