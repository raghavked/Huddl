# App Store submission kit

Everything the listing needs, ready to paste. The build/submit commands live
in `mobile/README.md`; this file is the store-facing copy plus the review
checklist.

## Listing copy

- **Name**: Hearth
- **Subtitle** (30 chars): Your campus, gathered.
- **Category**: Social Networking (secondary: Education)
- **Keywords** (100 chars):
  `college,campus,classes,study,flashcards,notes,grades,focus,student,clubs,rideshare,gpa,uc davis`

**Description**:

> Hearth is your whole campus in one app: every class, club, and study
> session, with the people actually in them.
>
> Add your classes in seconds: type a course code and the campus catalog
> fills in the rest, or add any class by hand. Each course opens into a
> home of its own: a main chat, rooms for lectures and study groups, a
> shared class calendar, flashcard decks, pinned links, and shared notes.
> When the quarter ends, shelve the class; the chat and the notes stay
> exactly where you left them.
>
> Paste your syllabus and the whole quarter lands on the class calendar:
> assignment due dates, quizzes, midterms, finals. Your personal study
> plan sorts everything across your classes by what's overdue, what's due
> today, and what's coming, with recommended study blocks before every exam,
> and one month view merges all of it with the events you've said yes to.
> Set your own reminder on anything, from fifteen minutes out to two weeks.
>
> There's a board for the things students actually need from each other:
> rides home for break, a lost water bottle, a couch that needs a new
> apartment, a tutor, a bike for sale. Post it, and when it's sorted, mark
> it sorted.
>
> The study tools are the part you'll actually open at 11pm. Shared
> flashcard decks your whole class builds, with spaced repetition and a
> paste-a-study-guide importer. A focus timer that shows who else on
> campus is heads-down right now, so you're never grinding alone. Study
> partners you opt into course by course. And a grade tracker that is
> private to you: weighted categories off your syllabus, an honest
> estimate of where you stand, and exactly what you need on the final.
>
> Chat is built for classmates: photos, polls, @mentions, pinned
> messages, threads, and reactions, with typing indicators and read
> state. DMs for the people you know, group DMs for the people you're
> working with. Clubs get their own space: chat, roster, events, and
> announcements from the officers. Study sessions and meetups take RSVPs
> and nudge everyone about an hour out.
>
> It's made to be lived in: a warm light theme, a candle-lit dark one,
> your own text size, quiet hours so nothing buzzes at 2am, and no ads
> anywhere.
>
> Every account is verified with a university email, so your campus is a
> real, closed community. Blocking, reporting, and a 24-hour moderation
> promise are built in. Read receipts and typing indicators are yours to
> switch off. When you do, you stop seeing other people's too. You can
> export everything Hearth holds that's yours in one tap, and delete your
> account and everything in it anytime, right from Settings.
>
> Launching at UC Davis. Your campus is next.

- **Promotional text** (170 chars): Every class, club, and study night on
  your campus, in one app. Syllabus in, study plan out, decks and grades in
  your pocket, and the chat is your classmates.
- **Support URL**: https://uhearth.app (privacy: https://uhearth.app/legal/privacy)
- **Marketing URL**: https://uhearth.app

## Age rating & review notes

- **Age rating questionnaire**: user-generated content → answer
  "Unrestricted Web Access: No", "Gambling: No"; the UGC questions are
  satisfied by in-app report + block + 24h moderation (App Review
  Guideline 1.2). Expected rating: **12+**.
- **Sign-in for review**: provide the demo account
  `alex.rivera@ucdavis.edu` / `hearth-demo-2026` in App Review notes, with
  the note that any-campus email signup is restricted to supported
  universities by design.
- **Account deletion** (Guideline 5.1.1(v)): Settings → Delete account.
- **Data export** (Guideline 5.1.1(v) companion): Settings → Privacy → Your
  data. Returns the caller's own rows as one JSON document; self-only by
  construction, since every subquery in the function filters on `auth.uid()`.
- **Moderation is staffed**: reports from the in-app flow
  land in a queue that campus moderators triage inside the app (open /
  reviewed / dismissed, with the reported content shown in place). The
  moderator flag is a service-role write and is excluded from the
  column-scoped update grant students hold, so no account can promote itself.
- **The campus board is UGC and is covered by the same tools**: every post
  can be reported, the author can close or delete their own, and posts are
  visible only within one verified university.
- **Permissions**: photo library + camera strings are set in app.json
  (chat photos, profile photos). Push permission is requested in-context.
- **Grades are private, not a record system**: the grade tracker is a
  student's own scratch math, stored self-only (no classmate, officer, or
  school can read a row) and never shared with an institution. Worth
  saying in the review notes so it isn't read as an academic-records
  integration.
- **"Studying now" is campus-scoped**: a focus session shows only to other
  verified students at the same university, and only while it's running.

## Screenshot plan (6.7" + 6.1", both themes)

1. Home: today strip + plan card ("Your campus, gathered")
2. Course home: the six-doorway grid ("Every class is a home")
3. Syllabus import preview ("Paste the syllabus, get the quarter")
4. Study plan ("Always know what's next")
5. Flashcards mid-flip ("Decks your whole class builds")
6. Focus: timer running, studying-now list ("Nobody studies alone")
7. Grades: categories + what-if ("Private. Only you see this.")
8. Channel chat with a poll + photo ("Chat that carries the class")
9. Campus board: a rides list before break ("Ask your campus")
10. Semester overview: the term on one screen ("How the quarter's going")

Shoot the dark theme for Focus and Flashcards. The candle-lit palette is
the most distinctive thing on the shelf, and those are the late-night
screens anyway. Shoot the board in light: it's the one screen a browsing
stranger understands with no context, so it earns a slot near the front.

## Pre-submission checklist

- [ ] Apple Developer Program membership active
- [ ] `eas build --platform ios --profile production`
- [ ] `eas submit --platform ios` (uses mobile/eas.json)
- [ ] EAS projectId written into app.json by `eas init` (this also
      activates production push delivery end to end)
- [ ] Legal docs attorney-reviewed (docs/LEGAL.md checklist)
- [ ] hello@uhearth.app mailbox live (referenced by Terms + Privacy)
- [ ] Supabase Auth: enable leaked-password protection (dashboard)
- [ ] Supabase Auth: production SMTP + email templates branded
- [ ] App Privacy questionnaire: collects email, name, user content
      (messages, files, flashcards, private grade entries), coarse
      identifiers (university); no tracking, no ads, no data sale
