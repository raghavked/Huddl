# App Store submission kit

Everything the listing needs, ready to paste. The build/submit commands live
in `mobile/README.md`; this file is the store-facing copy plus the review
checklist.

## Listing copy

- **Name**: Huddl
- **Subtitle** (30 chars): Your campus, in one huddle.
- **Category**: Social Networking (secondary: Education)
- **Keywords** (100 chars):
  `college,campus,classes,study group,notes,chat,course,student,university,uc davis,clubs,calendar`

**Description**:

> Huddl is your whole campus in one app — every class, club, and study
> session, with the people actually in them.
>
> Add your classes in seconds: type a course code and the campus catalog
> fills in the rest, or add any class by hand. Each course opens into a
> home of its own — a main chat, rooms for lectures and study groups, a
> shared class calendar, and shared notes.
>
> Paste your syllabus and the whole quarter lands on the class calendar:
> assignment due dates, quizzes, midterms, finals. Your personal study
> plan sorts everything across your classes — what's overdue, what's due
> today, what's coming — with recommended study blocks before every exam.
>
> Chat is built for classmates: photos, polls, @mentions, pinned
> messages, threads, and reactions, with typing indicators and read
> state. DMs for the people you actually know. Clubs get their own
> space — chat, roster, events. Study sessions and meetups take RSVPs
> and land on your calendar.
>
> Every account is verified with a university email, so your campus is a
> real, closed community. Blocking, reporting, and a 24-hour moderation
> promise are built in, and you can delete your account — and everything
> in it — anytime, right from Settings.
>
> Launching at UC Davis. Your campus is next.

- **Promotional text** (170 chars): Every class, club, and study session
  on your campus — one app. Syllabus in, study plan out, and the chat is
  actually your classmates.
- **Support URL**: https://huddl.app (privacy: https://huddl.app/legal/privacy)
- **Marketing URL**: https://huddl.app

## Age rating & review notes

- **Age rating questionnaire**: user-generated content → answer
  "Unrestricted Web Access: No", "Gambling: No"; the UGC questions are
  satisfied by in-app report + block + 24h moderation (App Review
  Guideline 1.2). Expected rating: **12+**.
- **Sign-in for review**: provide the demo account
  `alex.rivera@ucdavis.edu` / `huddl-demo-2026` in App Review notes, with
  the note that any-campus email signup is restricted to supported
  universities by design.
- **Account deletion** (Guideline 5.1.1(v)): Settings → Delete account.
- **Permissions**: photo library + camera strings are set in app.json
  (chat photos, profile photos). Push permission is requested in-context.

## Screenshot plan (6.7" + 6.1", both themes)

1. Home — plan card + campus channels ("Your campus, in one huddle")
2. Add courses — catalog autocomplete ("Type it, you're in")
3. Course home — calendar + rooms ("Every class is a home")
4. Syllabus import preview ("Paste the syllabus, get the quarter")
5. Study plan ("Always know what's next")
6. Channel chat with a poll + photo ("Chat that carries the class")

## Pre-submission checklist

- [ ] Apple Developer Program membership active
- [ ] `eas build --platform ios --profile production`
- [ ] `eas submit --platform ios` (uses mobile/eas.json)
- [ ] EAS projectId written into app.json by `eas init` — this also
      activates production push delivery end to end
- [ ] Legal docs attorney-reviewed (docs/LEGAL.md checklist)
- [ ] hello@huddl.app mailbox live (referenced by Terms + Privacy)
- [ ] Supabase Auth: enable leaked-password protection (dashboard)
- [ ] Supabase Auth: production SMTP + email templates branded
- [ ] App Privacy questionnaire: collects email, name, user content
      (messages, files), coarse identifiers (university); no tracking,
      no ads, no data sale
