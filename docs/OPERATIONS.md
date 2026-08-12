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
- **In-app reporting**, from the overflow menu on a message, a person, or a
  board post. Eight categories, an optional note, and a rate limit so the
  flow cannot itself be used to harass. A report keeps its subject even if the
  message is later hard-deleted.
- **The moderation queue** at `/moderation` on both clients, open to anyone
  with `profiles.is_moderator`. Open / reviewed / dismissed with counts, the
  reported content rendered in place, and one tap through to the message, the
  profile, or the board post.

### Promoting a moderator

`is_moderator` is **not** self-assignable, and that is enforced in the schema
rather than in the UI: the `authenticated` grant on `profiles` is
column-scoped and does not include it (migration 0034). Promotion is a
service-role write, deliberately:

```sql
update public.profiles set is_moderator = true where handle = '<handle>';
```

Do it from the Supabase SQL editor, and only for a student who has agreed to
the role. Demotion is the same statement with `false`. There is no in-app
path to either, and there should not be one until there is a council to
answer to.

### Roadmap (in order)

1. **Removal history and a per-channel audit log** — the queue records the
   triage decision but not yet the removals that followed it.
2. **Campus moderator council** — per-campus group of vetted student mods for
   cross-channel issues, appeals, and policy input.
3. **Rate limits + new-account friction** for burst abuse during rush periods.
   Reports are rate-limited today; messages and board posts are not.

---

## 3a. Scheduled jobs

Five `pg_cron` jobs run against the production database. They are defined in
the migrations, not in the dashboard, so `supabase/migrations/` is the source
of truth — but they run whether or not anyone is watching, and this is the
list to check first when something arrives late, twice, or not at all.

| Job | Schedule (UTC) | Function | What it does |
| --- | --- | --- | --- |
| `huddl-push-digests` | `*/5 * * * *` | `send_push_digests()` | One push for a pile of deferred notifications |
| `huddl-calendar-reminders` | `10 * * * *` | `send_calendar_reminders()` | Your own lead time on a due date |
| `huddl-event-reminders` | `25 * * * *` | `send_event_reminders()` | Before an event you said yes to |
| `huddl-weekly-digest` | `0 15 * * 1` | `send_weekly_digest()` | The week ahead in your classes |
| `huddl-weekly-recap` | `0 1 * * 0` | `send_weekly_recap()` | Your week, in short — Saturday evening on the coast |

The two reminder sweeps run hourly, at :10 and :25 rather than both at :00 —
staggered so they never contend, and offset from the digest sweep. Hourly is
also the real resolution of a reminder: a lead time of "a day before" is
honoured to within the hour, not to the minute, and the copy is written to
match. Do not tighten these to `*/5` to make a reminder feel prompter; the
sweeps scan forward from `now()` and a shorter period only re-scans the same
rows.

To see them, their last run, and whether any are failing:

```sql
select jobname, schedule, active from cron.job order by jobname;

select j.jobname, r.status, r.start_time, r.return_message
from cron.job_run_details r join cron.job j using (jobid)
where r.start_time > now() - interval '24 hours'
order by r.start_time desc limit 50;
```

**Two things to know before debugging a quiet phone.** Notifications are
written by the app and pushed by a BEFORE-INSERT trigger on `notifications`;
the trigger defers rather than sends when the student is inside their quiet
hours, or when a push already went out in the last two minutes. Deferred rows
have `pushed_at is null`, and `huddl-push-digests` is what eventually carries
them. So "no push arrived" is usually correct behaviour, and the query that
tells you which is:

```sql
select kind, title, created_at, pushed_at
from public.notifications
where user_id = '<uuid>' order by created_at desc limit 20;
```

A row with `pushed_at` set was delivered to Expo. A row still null after the
digest window means either quiet hours or no registered device — check
`push_tokens` before assuming the pipeline is broken.

Since 0039 there is a third state. A notification that was never going to be
pushed — the student muted that room, or switched that kind off — is stamped
`pushed_at = '-infinity'` rather than `now()`. It reads as settled so the
digest leaves it alone, but it can never be mistaken for a delivery, which is
what the two-minute coalesce probe used to do: before the fix, one muted room
silenced every unrelated push for two minutes. So `'-infinity'` means
"deliberately not sent", a real timestamp means delivered, and null still
means deferred.

---

## 3b. Deploying migrations 0039 and 0040

These two ship together and in order, and they are worth reading before you
run them — 0039 in particular changes who can read files.

**0039 fixes a live data exposure.** The `chat-uploads` bucket granted read to
every authenticated user, so every DM photo in the product was readable by any
signed-in student on any campus. Section 1 replaces that. Before deploying,
sanity-check the path assumption on a branch: pick a real
`messages.attachment_path` and confirm

```sql
select 1 from storage.objects
where bucket_id = 'chat-uploads' and name = '<that path>';
```

returns a row. If production ever wrote a URL-encoded or bucket-prefixed path,
images would go blank instead of merely getting safer.

**Two operational notes on 0039.** It creates two partial indexes on
`messages` and `dm_messages` non-concurrently, which takes a SHARE lock and
blocks sends on both tables for the length of the build — deploy it in a quiet
window, or build those two indexes CONCURRENTLY out-of-transaction first (the
`if not exists` guards make the migration idempotent against that). And an
object whose message row was hard-deleted becomes readable only to its
uploader, so any client holding a cached signed URL starts getting 403s once
the one-hour TTL lapses.

**0040 changes behaviour for students who narrow a setting.** `dm_privacy`
defaults to `'campus'`, which is exactly today's reach, so nothing changes on
deploy for anyone who leaves it alone. But it binds the group RPCs as well as
the 1:1 one, so a student who picks `'classmates'` can no longer be added to a
club chat by an officer who shares no course with them. That is deliberate —
it is the same inbox and the same push — but it is a product call, not purely
a security fix.

**The clients depend on both.** `focus_sessions.is_private` is in the mobile
app's `FOCUS_SELECT` and `profiles.dm_privacy` is in its privacy query, so the
focus feature and the privacy screen fail outright against a database that
does not have 0040. Ship the migrations first, or ship them together.

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
