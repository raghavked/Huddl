# Huddl Operations Playbook

How Huddl launches, grows, and stays worth trusting — campus by campus.

The core lesson we take from YikYak's rise (and the graveyard of "social apps
for college"): **a half-empty campus is worse than no campus.** A student who
opens Huddl and finds three people never comes back. So we optimize for
*density before breadth* — one campus at a time, each one loud before the next
one opens.

---

## 1. Rollout model: density before breadth

### Campus lifecycle

| Stage | Definition | What's true |
| --- | --- | --- |
| **Seeded** | University row + default channels exist in the database (`supabase/seed.sql`) | Signup works technically; we do zero promotion |
| **Waitlist** | Students at the campus are signing up organically | We watch the count; ambassadors are being recruited |
| **Open** | **50 verified signups** | Launch week begins; ambassadors activated; we promote on campus |
| **Active** | ≥ 20% of weekly signups return the following week and course-channel coverage is growing | Normal operations; weekly metrics review |
| **Anchor** | The campus sustains itself without ops effort for a full term | It becomes the reference for the next campus's launch |

### Why 50 signups to "open"

50 verified students at one school reliably yields critical mass in at least a
few course channels plus a live #general. Below that, every channel is a ghost
town and first impressions are fatal. Above it, the enrollment triggers do the
work: each new student lands in course channels that already have classmates in
them. We never announce a campus before it crosses the line.

### Rollout order

1. **UC Davis** — launch campus. Big undergrad population, quarter system
   (three enrollment shocks a year, each one a growth event), strong club
   culture.
2. **Rest of the UC system** — Berkeley, UCLA, San Diego, Irvine, Santa
   Barbara, Santa Cruz, Riverside, Merced (all pre-seeded in `seed.sql`).
3. **CSUs** — added one row at a time to `seed.sql` as each campus is opened.

One new campus opens only when the previous one is **Active**. Never launch two
campuses in the same week — launch weeks are hands-on.

### Opening a campus (mechanics)

1. Insert the university row (name, short name, email domain, city, state) into
   `supabase/seed.sql` and run it — default channels (#general,
   #study-buddies, #campus-events, #asks-and-offers) and the current term are
   created by the same script.
2. Verify signup with a test address on that domain: profile creation and
   auto-join to default channels are handled by database triggers.
3. Recruit ambassadors (below) *before* promoting anything.

---

## 2. Launch-week playbook (per campus)

### T-minus 2 weeks

- Recruit **5 student ambassadors**: aim for coverage, not clones — one from a
  big intro-course major (bio/econ/CS), one club officer, one from Greek or
  residential life, one transfer or grad student, one generally-online person
  who runs a meme page or group chats. Ambassadors get: founding-member flair
  when cosmetics ship, direct line to the team, and a real say in the roadmap.
- Each ambassador commits to: seeding their own course list on day one, posting
  daily in week one, and hosting or co-hosting one event.

### Day 1 — seed the campus

- Default channels exist from day zero (seeded, auto-joined at signup) — the
  job is making them *look inhabited*. Every ambassador posts a real message in
  #general and a real ask in #asks-and-offers within the first hour.
- Ambassadors add their full course lists by hand (the catalog autocompletes
  as they type), which creates the first wave of course channels. Target:
  **30+ course channels live on day one**, so early signups land somewhere
  warm.
- Ambassadors upload one genuinely useful note each to their biggest course.

### Days 2–4 — first events

- Each ambassador creates one **study session** tied to a large course
  (midterm review for the biggest intro class is the reliable winner) and one
  casual meetup (coffee, pickup game, dining-hall table).
- Events are the demo: RSVP list fills → people see names they recognize →
  the event page does the selling.

### Days 5–7 — the visible push

- Tabling / flyering with a QR straight to `/signup`. The pitch is one
  sentence: *"It's your classes, already set up — sign in with your school
  email."*
- Club partnerships: offer club officers their own space (chat + roster +
  events) in exchange for announcing to members.
- End of week: first "campus-events" digest post from the team highlighting the
  weekend's meetups.

### Launch-week success bar

- 200+ verified signups, 50+ course channels with ≥ 3 members,
  10+ events created, and at least one channel that's funny without our help.

---

## 3. Moderation

Safety is a launch feature, not a scale feature. The approach mirrors the
product: campus-scoped, student-led, with real accountability (every account is
a verified student — there are no anonymous throwaways, which is the other
YikYak lesson).

### Now (launch)

- **Student moderators per channel.** Channel creators moderate what they
  create; default campus channels are moderated by ambassadors. Moderators can
  remove messages (soft delete — `deleted_at`, nothing is destroyed) and set
  the tone by being the most active constructive voice.
- **Community baseline**, stated in every default channel description and at
  signup: real names or known handles, no harassment, no selling exam
  materials, nothing that targets an individual. Verified identity does most of
  the enforcement work for us.
- **Escalation path:** moderators flag serious issues (threats, harassment,
  academic-integrity schemes) directly to the team; we respond within 24 hours
  and can disable accounts at the auth level.

### Roadmap (in order)

1. **In-app report flow** — report a message/user from the overflow menu,
   routed to channel moderators with team visibility.
2. **Moderator tools page** — queue of reports, removal history, per-channel
   audit log.
3. **Campus moderator council** — per-campus group of vetted student mods for
   cross-channel issues, appeals, and policy input.
4. **Rate limits + new-account friction** for burst abuse during rush periods.

---

## 4. Growth loops

The product grows itself when the loops are healthy; ops exists to keep them
spinning.

**Loop 1 — the course-channel pull (acquisition).**
A student adds their classes → channels for *their exact classes* exist and
have classmates in them → the channel is useful within minutes (a due-date
question gets answered) → they tell the classmate sitting next to them, whose
channels are *also* already waiting. Every enrollment makes the next signup's
first five minutes better. Ops job: keep day-one course-channel coverage high
at every campus (ambassador course lists, enrollment-shock pushes at the start
of each term).

**Loop 2 — notes and events (retention).**
Chat brings you in; notes and events bring you *back*. A note uploaded in week
2 pays off through finals; an RSVP is a promise to return on a specific date.
Ops job: make sure every big course has at least one note early in the term and
every campus has events on the board every week. These are the two levers we
pull when a campus's return rate dips.

**Loop 3 — the term reset (re-acquisition).**
Every new term, class lists change and the course-channel pull fires again for
*everyone*, including lapsed users. The first two weeks of each term are a
launch-week-lite at every Active campus: ambassadors re-seed their course
lists, the team prompts everyone to add the new term's classes, and
midterm-season events follow.

---

## 5. Revenue model

**The core is free, forever.** Course channels, campus channels, DMs, notes,
events — a student never pays to talk to their classmates.

Later, in rough order of appearance:

1. **Campus partnerships** — universities, departments, and student
   governments pay for official presence and tools (verified org spaces,
   announcement reach, event promotion for official programming). They get
   distribution; students get signal.
2. **Sponsored events & local businesses** — the coffee shop sponsors the
   finals-week study session; the pizza place backs the club fair meetup.
   Clearly labeled, event-scoped, campus-local. Sponsorship buys presence at an
   event, never presence in a conversation.
3. **Premium cosmetics** — profile flair, channel themes, founding-member
   badges. Vanity, priced like vanity; zero functional gating.

**Red lines, permanent:**

- **We never sell student data.** Not to advertisers, not to universities, not
  "anonymized and aggregated." The verification/privacy story *is* the brand.
- **Never ads inside course channels.** Course channels are the classroom's
  hallway — commercializing them burns the trust that makes everything else
  possible.

---

## 6. Success metrics

Measured **per campus, per week** — a blended global number hides a dying
campus behind a launching one.

### North-star set

| Metric | Definition | Healthy signal |
| --- | --- | --- |
| **Weekly active per campus** | Verified students with ≥ 1 session in 7 days | Growing every week until Anchor; never > 20% week-over-week decline outside breaks |
| **Messages per DAU** | Channel + DM messages sent ÷ daily actives | ≥ 5 — proves people talk, not lurk; falling means channels feel dead |
| **Course-channel coverage per term** | Share of the campus's live course channels with ≥ 3 members | ≥ 60% by week 3 of each term at Active campuses — this is the acquisition loop's fuel gauge |

### Supporting set

- **Week-1 return rate** (signed up last week, active this week) — the honest
  launch-quality number.
- **Notes per active course channel** and **weekly RSVPs per campus** — leading
  indicators for retention (Loop 2).
- **Time-to-first-message** for new signups — the onboarding number; if it
  rises, day-one channel warmth is slipping.
- **Reports per 1k messages** — moderation guardrail; spikes trigger the
  escalation path review.

### Operating rhythm

Weekly campus review: every campus gets a one-line status (stage, WAU trend,
messages/DAU, coverage). Any Active campus that misses two weeks in a row gets
a Loop-2 intervention (events push + notes drive) before we spend a minute on
the next launch. Density before breadth applies to attention, too.
