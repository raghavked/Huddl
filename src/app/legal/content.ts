/**
 * Huddl's legal documents — Terms of Service, Privacy Policy, and Community
 * Guidelines — as structured data for the public /legal/* pages.
 *
 * NOTE ON DUPLICATION: the native app is the source of truth for this copy —
 * mobile/src/lib/legal-content.ts — but the web tsconfig can't import from
 * mobile/, so the strings are duplicated here verbatim. If you change wording
 * there, make the identical change here. docs/LEGAL.md indexes both copies.
 */

export type LegalSection = {
  heading: string;
  body: string;
};

export type LegalDoc = {
  title: string;
  updated: string;
  sections: LegalSection[];
};

export const TERMS_OF_SERVICE: LegalDoc = {
  title: "Terms of Service",
  updated: "August 2026",
  sections: [
    {
      heading: "Welcome",
      body: "Huddl is where your campus hangs out — a chat for every course you add, campus channels, clubs, study sessions, shared notes, and messages, all verified by your school email. These terms are the agreement between you and Huddl when you use our app or website. They're written to be read, not skimmed past: they cover who can join, what you can post, and what we do to keep Huddl a good place to be.",
    },
    {
      heading: "Who can join",
      body: "Huddl is for people who are part of a campus. You must be at least 13 years old and enrolled at or affiliated with a supported university. Your university email address is how we check — you sign up with it and confirm it from your inbox, and that places you in your campus community, and only that one.",
    },
    {
      heading: "Your account",
      body: "Your account is yours alone. Keep your password to yourself, don't let anyone else post as you, and don't create accounts for other people. You're responsible for what happens under your handle, so tell us right away if you think someone else has gotten into your account.",
    },
    {
      heading: "What you post is yours",
      body: "Everything you share on Huddl — messages, notes, files, events, polls, your course list, your profile — belongs to you. To run the service, you give us permission to store it, back it up, and show it to the classmates you shared it with. That permission exists so Huddl can work; it doesn't let us sell your content or use it for advertising, and it ends for anything you delete.",
    },
    {
      heading: "What you're responsible for",
      body: "Only share things you have the right to share. Your own notes are always fair game; a scanned textbook chapter or a leaked exam is not. You're responsible for what you post, and if it breaks these terms or our Community Guidelines, we may remove it.",
    },
    {
      heading: "The ground rules",
      body: "Our Community Guidelines are part of these terms — they spell out what being a good classmate looks like on Huddl. The short version: no harassment, no hate, no spam, no impersonation, no sexual content, take self-harm concerns seriously, and keep your schoolwork honest.",
    },
    {
      heading: "Reporting and enforcement",
      body: "Every message and profile on Huddl can be reported in the app, with a category so we can sort out the urgent things first. We review reports within 24 hours. Depending on what we find, we may remove content, warn the person, or suspend or ban the account — permanently for serious or repeated violations. We also apply gentle rate limits so no one can flood a channel or the report queue.",
    },
    {
      heading: "Huddl and your university",
      body: "Huddl is an independent student space. We're not affiliated with, run by, or endorsed by your university, and nothing on Huddl connects to your school's official systems. Your course list is entered by you and managed by you; your grades, enrollment records, and school accounts never touch Huddl.",
    },
    {
      heading: "Leaving Huddl",
      body: "You can delete your account any time from Settings in the app. Deletion is immediate and permanent: your profile, messages, files, courses, and everything else tied to your account are erased. There's no archive we quietly keep. One thing survives, and we'd rather say so than let you find out: if a classmate forwarded one of your messages, that forward is their message, in their room, and it keeps the text — it just stops being credited to you.",
    },
    {
      heading: "Our service to you",
      body: "The core of Huddl is free for students, carries no ads, and your data is never for sale. We work hard to keep Huddl fast and available, but like any online service we can't promise it will never hiccup — Huddl is provided as is, and features may change as the product grows. If we make a change that meaningfully affects you, we'll tell you in the app first.",
    },
    {
      heading: "The fine print, in plain words",
      body: "To the extent the law allows, Huddl isn't liable for indirect damages — things like lost data from an outage, or what another user says or does. Nothing in these terms takes away rights the law guarantees you, and if any part of these terms turns out to be unenforceable, the rest still stands.",
    },
    {
      heading: "Changes to these terms",
      body: "If we update these terms, we'll change the date at the top, and for anything significant we'll let you know in the app before it takes effect. Continuing to use Huddl after that means you accept the update.",
    },
    {
      heading: "Talk to us",
      body: "Questions about these terms, or something that doesn't seem right? Email hello@huddl.app — a human reads it.",
    },
  ],
};

export const PRIVACY_POLICY: LegalDoc = {
  title: "Privacy Policy",
  updated: "August 2026",
  sections: [
    {
      heading: "The short version",
      body: "We collect what Huddl needs to work and nothing more. Your data is never sold, never used for advertising, and never shared with your university. Everything you post stays inside your verified campus, and you can delete your account — and everything in it — right from the app.",
    },
    {
      heading: "What you give us",
      body: "When you sign up we ask for your university email address, a password, and a display name. Your password is stored only in protected, encrypted form — we never see it. Your handle starts out as the part of your email address before the @, it's visible to your campus, and you can change it to anything you like in Account. Everything else on your profile is optional and up to you: major, graduation year, bio, photo.",
    },
    {
      heading: "What you create",
      body: "Your course list — entered by you, never pulled from your school — plus the channels and clubs you join, and the things you share: messages and direct messages, notes and files, events and RSVPs, polls and reactions. We store this so your classmates can see it. That's the product.",
    },
    {
      heading: "Safety and device data",
      body: "If you report something or block someone, we keep a record so we can act on the report and keep the block working. If you turn on notifications, we store a push token — the delivery address your device gives us — which you can switch off any time. We also keep routine technical records, like the timestamps behind our rate limits, to keep Huddl healthy.",
    },
    {
      heading: "What we never collect",
      body: "We don't connect to your university's systems, so we never see your grades, transcripts, class rosters, or official enrollment. We don't track your location, we don't read your contacts, and there are no advertising trackers anywhere in Huddl.",
    },
    {
      heading: "Who can see what",
      body: "Course chats are visible only to classmates who added the same course. Campus channels are visible only to verified students at your school. Club spaces are for their members, and direct messages are for the two people in them. Your profile is visible to your campus; turn Public profile off and classmates see only your handle and your photo. Nothing you write on Huddl is reachable from the wider internet — the one exception is your profile photo, which is served from a public link, so anyone who has that link can open it without signing in. Someone you block can't message you, and the things they write — messages, board posts, the line on their study session — stay out of your view. They're never told, and nothing in Huddl will tell them.",
    },
    {
      heading: "How we use your data",
      body: "To run Huddl: showing the right content to the right classmates, delivering your messages and notifications, and keeping the community safe by reviewing reports and enforcing blocks and rate limits. That's it — no ad targeting, no marketing profiles, no selling.",
    },
    {
      heading: "Where your data lives",
      body: "Huddl's database and uploaded files are hosted with Supabase, our infrastructure provider, in secured data centers. Data is encrypted in transit, and access rules are enforced at the database level — so a direct message, for example, can only ever be read by the two people in it.",
    },
    {
      heading: "When we share",
      body: "We never sell your data, full stop. We share it only with the services that make Huddl run — Supabase for hosting and Expo for delivering push notifications — and only as needed for them to do that job. Beyond that, we would disclose data only if the law requires it or it's necessary to prevent serious harm to someone.",
    },
    {
      heading: "Deleting your data",
      body: "You're in control: edit or clear your profile any time, drop courses, and leave channels whenever you like. Removing your profile photo deletes the file, not just the link to it. Deleting your account — Settings, then Delete account — removes everything at once: profile, messages, files, courses, blocks, and push tokens, immediately and permanently. There's no recovery window and no archive. The one thing that outlives it is a message of yours a classmate forwarded somewhere else: that copy is their message now, and it keeps the text with your name taken off it.",
    },
    {
      heading: "Age",
      body: "Huddl is for people 13 and older who are enrolled at or affiliated with a supported university. We don't knowingly collect data from anyone under 13, and if we learn that we have, we'll delete it.",
    },
    {
      heading: "Changes to this policy",
      body: "If this policy changes, we'll update the date at the top, and for anything significant we'll let you know in the app before it takes effect.",
    },
    {
      heading: "Talk to us",
      body: "Questions about your data, or a request we can help with? Email hello@huddl.app — a human reads it.",
    },
  ],
};

export const COMMUNITY_GUIDELINES: LegalDoc = {
  title: "Community Guidelines",
  updated: "August 2026",
  sections: [
    {
      heading: "Why these exist",
      body: "Huddl is your campus — the same people you sit next to in lecture. These guidelines keep it a place worth showing up to, and they apply everywhere on Huddl: course chats, campus channels, clubs, events, direct messages, notes, and profiles.",
    },
    {
      heading: "Be a good classmate",
      body: "The bar is simple: treat people here the way you'd treat them across a table in the dining hall. Debate ideas as hard as you like — just aim at the idea, not the person.",
    },
    {
      heading: "No harassment or bullying",
      body: "Don't insult, threaten, or pile onto people, and don't keep contacting someone who's asked you to stop. If someone blocks you, respect it — trying to reach them another way counts as harassment.",
    },
    {
      heading: "No hate",
      body: "Attacking people for who they are — race, ethnicity, religion, gender, sexual orientation, disability, or anything else about their identity — has no place here. Not in channels, not in DMs, not as a joke.",
    },
    {
      heading: "Be yourself",
      body: "Use your own name or a handle your classmates know you by. Don't impersonate other students, professors, clubs, or Huddl itself, and stick to one account.",
    },
    {
      heading: "No spam or scams",
      body: "Selling your old textbook in asks-and-offers is great. Blasting every channel with the same message, pushing get-rich schemes, phishing for logins, or advertising at your classmates is not.",
    },
    {
      heading: "Keep it appropriate",
      body: "No sexual content on Huddl — this is a campus community that includes students under 18. Anything sexualizing a minor will be removed and reported to the authorities.",
    },
    {
      heading: "Take care of each other",
      body: "If someone talks about hurting themselves, take it seriously. Report it with the self-harm category so we see it quickly, and encourage them toward campus counseling or the 988 Suicide & Crisis Lifeline — call or text 988, any time. Raising a concern never gets anyone in trouble.",
    },
    {
      heading: "Keep your work honest",
      body: "Sharing notes, forming study groups, and walking each other through a tough problem set is exactly what Huddl is for. Uploading exam answers, doing someone's assignment for them, or organizing plagiarism is not — your school's academic integrity policy applies to what you do here, and so do we.",
    },
    {
      heading: "Respect people's privacy",
      body: "Don't share anyone's personal information — address, phone number, schedule, photos — without their okay, and don't screenshot private conversations to embarrass someone. What classmates share inside Huddl stays in its room.",
    },
    {
      heading: "What happens when rules break",
      body: "Every report is reviewed by a person within 24 hours. Depending on what we find, we remove content, warn people, or suspend or ban accounts — and serious things like hate, threats, or sexualizing minors mean an immediate ban. We'd rather teach than punish, but we'll always protect the community first.",
    },
    {
      heading: "Report it",
      body: "See something that breaks these guidelines? Long-press any message and choose Report — pick the closest category, add a note if you like, and we'll take it from there within 24 hours. You can also report or block someone from their profile; blocking is instant and silent, and you can manage your list any time under Settings → Blocked people.",
    },
  ],
};
