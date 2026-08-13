# Hearth compliance checklist

What the code and the documents now say, and what is left that only the
operator can do. Written after an audit that read the three legal documents
against the schema rather than on their own, which is how the two errors at
the top of this file were found.

This file is not legal advice and nobody who wrote it is a lawyer. It is a
list of things to hand to one.

## Fixed in the app

| Was | Now |
| --- | --- |
| Terms said "your grades never touch Hearth"; the app has a grade estimator | Discloses self-entered marks as private to the student, and separates "we never pull from your university" from "you can type your own" |
| No copyright position at all, on a product whose core feature is uploading coursework | Notice-and-takedown, counter notice, and repeat-infringer termination in the Terms, echoed in the Guidelines |
| "We review reports within 24 hours", unconditional, in 3 documents and 8 places in the clients | "A person reads every report, usually within a day", safety first, in all eleven |
| No governing law, venue, indemnity, liability cap, or termination right | All present, with `[STATE]` and `[COUNTY, STATE]` to fill |
| No retention periods, no data location, no GDPR or CCPA rights section | All present. Data location named as Oregon, US |
| Age floor 13, with the Guidelines admitting under-18 users | 16, asserted in both signup captions as well as the Terms |
| `notes` bucket took any file under 25 MB | 16 coursework content types (migration 0049), generated from one table both clients are written from |

## Blocking, before anyone outside your campus can sign up

1. **Name the legal entity.** Six placeholders in the documents:
   `[LEGAL ENTITY NAME]`, `[ADDRESS]`, `[STATE]`, `[COUNTY, STATE]`,
   `[DMCA AGENT NAME]`, `[DMCA AGENT ADDRESS]`, `[DMCA AGENT EMAIL]`. They
   appear in both `mobile/src/lib/legal-content.ts` and
   `src/app/legal/content.ts` and must be changed in both. Grep for `[` to
   find them.
2. **Register the DMCA agent** at dmca.copyright.gov. It costs about six
   dollars and has to be renewed every three years. This matters more than
   the policy text: publishing a takedown procedure without a registered
   agent does not get you the section 512 safe harbour, and without the safe
   harbour you are directly liable for a textbook chapter a student uploads.
   The registered details must match what the Terms say.
3. **Make the mailboxes real.** `hello@uhearth.app` and the DMCA address have
   to receive mail and be read. A contact address that bounces is a GDPR
   failure and an App Store rejection.
4. **Have a lawyer read all three documents.** `docs/LEGAL.md` has said this
   since they were drafted and it is still true. The liability cap, the
   indemnity and the governing law clause are the parts most worth an hour of
   someone's time.

## Before the App Store

5. **There is no iOS privacy manifest.** Apple has required
   `PrivacyInfo.xcprivacy` since 2024. Add `ios.privacyManifests` to
   `mobile/app.json`. Declare the required-reason APIs the app actually uses
   (file timestamps and user defaults, via AsyncStorage) and declare no
   tracking, which is true.
6. **App Store Connect**, none of which lives in this repo: the privacy
   nutrition label, an age rating consistent with a 16+ social app carrying
   user content, the privacy policy URL, and a support URL.
7. Guideline 1.2 (user-generated content) wants a way to report, a way to
   block, published terms, and a contact. All four exist. Guideline
   5.1.1(v) wants in-app account deletion; `delete_own_account()` is wired
   to Settings.

## Before Google Play

8. The Data safety form. The honest answers are unusually easy here: no
   analytics SDK, no advertising SDK, no location, no contacts, no
   advertising identifier. Verifiable from `package.json`, which is the
   whole dependency list.

## Infrastructure and configuration

9. **Accept the Supabase DPA** in the dashboard under Legal Documents. The
   privacy policy now says data leaving the UK or EU is covered by "the data
   processing terms we have in place with our host". That sentence is only
   true once the DPA is accepted. It was deliberately written without naming
   the standard contractual clauses, because asserting a mechanism you have
   not signed is the same class of error as the grades claim.
10. **Leaked password protection is off** in Supabase Auth. One toggle, and
    no migration can reach it. It rejects passwords known to be breached.
11. **The Supabase project is on the Free plan.** Two consequences worth
    knowing. Free projects pause after a week of inactivity, which is a
    service problem for a launched app and sits awkwardly with the Terms
    saying we work hard to keep Hearth available. And there is no backup
    retention window you can point at, which is why the retention section
    says a deleted message "can sit in our host's routine backups for a short
    while" rather than naming a number. Move to a paid plan and you can state
    a real figure.
12. **When the web app is deployed, name the host as a processor.** Today it
    is not deployed anywhere, so the policy naming Supabase and Expo is
    complete. A Vercel deployment adds a processor that handles IP addresses,
    and the "When we share" section has to grow by one name.

## Decisions taken, so a future reader knows they were deliberate

- **Minimum age 16, not 13 or 18.** Chosen by the operator. It puts the app
  above the GDPR digital-consent age in nearly every member state and out of
  most of the state minor-social-media regimes. It does not remove under-18
  users entirely, so the Guidelines still say the community includes them.
- **"Usually within a day", not "within 24 hours".** A volunteer student
  moderator queue cannot guarantee a deadline, and the old wording was a
  binding promise to users and a representation to Apple.
- **Applied migrations keep their em dashes** and their original text. They
  record what was run against the database.

## Verifiably true today, and worth keeping true

- No analytics, advertising or tracking SDK of any kind, in either client.
  The "no advertising trackers" claim can be checked against `package.json`
  in about ten seconds. Do not let the first analytics dependency in without
  changing the policy in the same commit.
- Data export and account deletion are both real, both in-app, and both
  database functions (`export_my_data`, `delete_own_account`).
- Campus scoping, the block, and the privacy of the grade estimator are
  enforced by row-level security, not by client code.
- No phone numbers are collected anywhere, since the Twilio badge was
  retired.

## Watch list, not urgent

- **The name.** Resolved in the strong direction: the app was renamed from
  Huddl to Hearth in August 2026, retiring the likelihood-of-confusion risk
  against Hudl (hudl.com). One caution remains: "hearth" is a common English
  word and other products use it, so a trademark search is still worth doing
  before spending on branding. The domain is uhearth.app, which is more
  distinctive than the bare word.
- **University names.** Using "UC Davis" to say which campus a community
  belongs to is nominative use and the Terms disclaim affiliation, which is
  the right posture. Do not use any university's logo, seal, or wordmark, and
  do not imply endorsement. UC's licensing office is active.
- **FERPA does not apply to you.** It binds schools and their contractors.
  Stay on that side of the line: do not market Hearth as school-affiliated,
  do not accept a feed of institutional records, and keep the course list
  something students type.
- **CCPA thresholds are not met** at current scale. Revisit at 100,000 users
  or if the business model ever changes. The rights section already grants
  the substance.
- **Under-18 users still exist** at a 16+ floor. If Hearth ever opens beyond a
  single verified campus, or lets adults outside the campus start
  conversations, that changes and the minor-safety analysis has to be redone.
