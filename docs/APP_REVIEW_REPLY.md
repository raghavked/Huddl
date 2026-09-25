# App Review reply kit (Guideline 2.1, information request)

Apple's first-submission questionnaire for new developer accounts. Paste
the "Reply" section into the App Store Connect message thread AND into
App Review Information > Notes, attach the recording, then press
Submit for Review again. Written 2026-09-25.

## Recording shot list (you, on the iPhone, 3 to 4 minutes)

Settings > Control Center > Screen Recording. One continuous take on the
current TestFlight build. Apple wants registration first, then the flow.
No real inbox is needed: the registration step only has to show the
sign-up form working, and the rest of the take uses the preloaded
account.

Accounts (all `HearthReview-2026!`): `maya@demo.uhearth.app` is yours
for the take (Maya Demo: profile filled in, enrolled in DEMO 101, in the
Board Games Club, friends with Sam, a DM from Sam waiting, one Quad
post). `deleteme@demo.uhearth.app` is for the deletion step.

1. Cold-launch Hearth from the home screen.
2. Tap Create account, enter `newstudent@demo.uhearth.app` and a
   password, submit. Show the "check your inbox" screen. (This creates an
   unconfirmed account on the review campus; harmless.)
3. Back to Log in. Sign in as Maya. Land on Home.
4. The Quad: scroll, upvote Sam's post, open it, add a comment.
5. Sam's post menu > Report > pick a reason > submit.
6. Open Sam's profile > Block > confirm. Show the feed without Sam.
   Settings > Privacy > Blocked > Unblock.
7. Rooms: open General, send a message, long-press it to react.
8. Courses: open DEMO 101, its chat, its calendar.
9. Events: RSVP to the DEMO 101 review session. Clubs: open Board Games.
10. Messages: open Sam's DM, reply.
11. Settings > Privacy > Your data (export). Log out.
12. Log in as `deleteme@demo.uhearth.app`. Settings > Delete account >
    confirm. Land on the sign-up screen. Stop recording.

Upload the .mov in the reply (Connect accepts attachments in the thread).

## Reply

**1. Screen recording**: attached. Captured on an iPhone running the
current iOS, from cold launch through registration, email confirmation,
login, user-generated content, reporting, blocking, and account deletion.

**2. Purpose and audience**: Hearth is a campus community app for
university students, launching at UC Davis. It solves the problem that a
student's campus life is scattered across group chats, club Discords,
syllabus PDFs and calendar apps that never talk to each other. In Hearth,
each class the student adds opens its own chat, calendar, notes and
flashcards; clubs have rooms, polls and events; the campus-wide feed (The
Quad) and interest communities carry conversation; direct messages and
friends cover the people they know. Membership is verified with a
university email, so every campus is a closed community of real
classmates, and every post carries a real name: nothing on Hearth is
anonymous. The target audience is enrolled university students aged 16
and up. The app is free, has no ads, no in-app purchases, and no paid
features.

**3. Setup and access**: Sign-up requires an email at a supported
university domain, so reviewers cannot register directly. Please use the
review campus, "Hearth Demo Campus (App Review)", an isolated university
that no real student can join; nothing done there touches a real campus.

- Reviewer account: `reviewer@demo.uhearth.app` / `HearthReview-2026!`.
  This account carries the moderator badge: Settings > Reports shows the
  moderation queue, so a report filed from any surface can be seen
  arriving and resolved.
- Classmate account: `student@demo.uhearth.app` / `HearthReview-2026!`
  (appears as "Sam Demo"). Sam has posted in the campus rooms and on The
  Quad, sent the reviewer a direct message, planned an event and started
  a club, so every report, block, reply, RSVP and join has a real target.
  Logging in as Sam on a second device shows both sides of a DM.
- Student account: `maya@demo.uhearth.app` / `HearthReview-2026!`
  ("Maya Demo"): an ordinary student with a filled-in profile, a class,
  a club, a friend, and a waiting DM, for seeing the app as a regular
  member rather than a moderator.
- Deletion account: `deleteme@demo.uhearth.app` / `HearthReview-2026!`.
  Settings > Delete account removes it and everything it wrote. We recreate
  it after each review.

Main features and where they live: Home (today's summary), The Quad and
Communities (feed: post, vote, comment, save, report), Rooms (campus and
course chat: messages, photos, reactions, threads, polls, pins),
Courses (add DEMO 101 from the catalog; chat, calendar, notes,
flashcards, links), Clubs (join Board Games Club; announcements, events),
Events (RSVP to the DEMO 101 review session), Messages (DMs and group
DMs), Friends (requests and presence), Settings > Privacy (blocked list,
data export, read-receipt and presence switches), Settings > Delete
account. No sample files are required.

**4. External services**: Supabase (Postgres database, authentication,
file storage, and realtime messaging; hosted in the United States),
Expo Application Services (build pipeline and the push-notification
relay to Apple Push Notification service), Resend (transactional email:
confirmation and password-reset messages only), and Vercel (hosts the
marketing website, the email-confirmation landing page, and the legal
pages at uhearth.app). No advertising, analytics, tracking, payment, or
AI services are used.

**5. Regional differences**: None. The app functions identically in
every region. Availability is limited to the United States on the store
because the app's first supported university is in California; the
software itself has no region-dependent features or content.

**6. Regulated industry or protected material**: Not applicable. Hearth
is not in a regulated industry and includes no third-party protected
material. All content is created by verified students, and the terms,
privacy policy, and community standards (https://uhearth.app/legal/terms,
/legal/privacy, /legal/guidelines) set out reporting, blocking, a
24-hour moderation commitment, automatic slur flagging, account deletion,
and data export.

## Recreating the deletion account after a review

Run against production (the account and its rows are gone once a reviewer
deletes it; the profile trigger recreates the profile and Quad seat):

```sql
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('d0000000-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deleteme@demo.uhearth.app', extensions.crypt('HearthReview-2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Delete Me"}', now(), now())
on conflict (id) do nothing;
```
