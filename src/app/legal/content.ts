/**
 * Hearth's legal documents (Terms of Service, Privacy Policy, and Community
 * Guidelines) as structured data for the public /legal/* pages.
 *
 * NOTE ON DUPLICATION: the native app is the source of truth for this copy,
 * in mobile/src/lib/legal-content.ts, but the web tsconfig can't import from
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
      body: "Hearth is where your campus hangs out: a chat for every course you add, campus channels, clubs, study sessions, shared notes, and messages, all verified by your school email. These terms are the agreement between you and Hearth when you use our app or website. They're written to be read, not skimmed past: they cover who can join, what you can post, and what we do to keep Hearth a good place to be.",
    },
    {
      heading: "Who can join",
      body: "Hearth is for people who are part of a campus. You must be at least 16 years old and enrolled at or affiliated with a supported university. Your university email address is how we check. You sign up with it and confirm it from your inbox, and that places you in your campus community, and only that one. If you are under 18, please read these terms with a parent or guardian.",
    },
    {
      heading: "Your account",
      body: "Your account is yours alone. Keep your password to yourself, don't let anyone else post as you, and don't create accounts for other people. You're responsible for what happens under your handle, so tell us right away if you think someone else has gotten into your account.",
    },
    {
      heading: "What you post is yours",
      body: "Everything you share on Hearth belongs to you: messages, notes, files, events, polls, your course list, your profile. To run the service, you give us permission to store it, back it up, and show it to the classmates you shared it with. That permission exists so Hearth can work; it doesn't let us sell your content or use it for advertising, and it ends for anything you delete.",
    },
    {
      heading: "What you're responsible for",
      body: "Only share things you have the right to share. Your own notes are always fair game; a scanned textbook chapter, a professor's slide deck, or a leaked exam is not. You're responsible for what you post, and if it breaks these terms or our Community Guidelines, we may remove it.",
    },
    {
      heading: "Copyright, and how to get something taken down",
      body: "Hearth hosts what students upload, and we take copyright seriously. If you own the rights to something posted here without your permission, tell us and we will act. Email dmca@uhearth.app with: your contact details; enough detail to find the material, such as a link or the course and the file name; a statement that you believe in good faith the use is not authorised; a statement, under penalty of perjury, that the information is accurate and you are the owner or authorised to act for them; and your signature, typed is fine. We remove or disable access to material that is properly reported, and we tell the person who posted it. If you think your material was removed by mistake, you can send a counter notice to the same address and we will pass it on. Accounts that infringe repeatedly are terminated. Our designated agent for copyright notices is Raghav Kedia, doing business as Hearth, 625 Cantrill Dr, Apt 345, Davis, CA 95618, dmca@uhearth.app.",
    },
    {
      heading: "The ground rules",
      body: "Our Community Guidelines are part of these terms, and they spell out what being a good classmate looks like on Hearth. The short version: no harassment, no hate, no spam, no impersonation, no sexual content, take self-harm concerns seriously, and keep your schoolwork honest.",
    },
    {
      heading: "Reporting and enforcement",
      body: "Every message and profile on Hearth can be reported in the app, with a category so we can sort out the urgent things first. A person reads every report. We aim to get to all of them within a day, and we look at anything flagged as a safety risk before anything else. Depending on what we find, we may remove content, warn the person, or suspend or ban the account, permanently for serious or repeated violations, including repeated copyright infringement. We also apply gentle rate limits so no one can flood a channel or the report queue.",
    },
    {
      heading: "Hearth and your university",
      body: "Hearth is an independent student space. We're not affiliated with, run by, or endorsed by your university, and nothing on Hearth connects to your school's official systems. University names are used only to say which campus a community belongs to. Your course list is entered by you and managed by you. We never pull your grades, transcripts, enrollment records or school accounts from your university, and no official record of yours reaches Hearth. If you choose to type your own marks into the grade estimator, that is your own note to yourself: it is stored privately, only you can read it, and it is not a school record.",
    },
    {
      heading: "Leaving Hearth",
      body: "You can delete your account any time from Settings in the app. Deletion is immediate and permanent: your profile, messages, files, courses, and everything else tied to your account are erased. There's no archive we quietly keep. Two kinds of thing survive, and we'd rather say so than let you find out. If a classmate forwarded one of your messages, that forward is their message, in their room, and it keeps the text. It just stops being credited to you. And anything you made for a class or a club to share and keep using (a flashcard deck, a card in one, a deadline on a course calendar, a link you added, a club announcement, a club or a channel you started) stays where it is, with your name taken off it. Deleting your account shouldn't empty your study group's deck or wipe a deadline off everyone else's calendar. Everything that was yours alone is gone: your profile, your messages, your files, your courses, your blocks, your push tokens.",
    },
    {
      heading: "Our service to you",
      body: "The core of Hearth is free for students, carries no ads, and your data is never for sale. We work hard to keep Hearth fast and available, but like any online service we can't promise it will never hiccup. Hearth is provided as is, and features may change as the product grows. If we make a change that meaningfully affects you, we'll tell you in the app first.",
    },
    {
      heading: "When we can close an account",
      body: "We can suspend or close an account that breaks these terms or the Community Guidelines, that infringes copyright repeatedly, or that puts other students at risk. For anything short of a serious safety problem we'll tell you what happened and why. We can also stop offering Hearth, or any part of it, and if we ever do we'll give you notice in the app and time to take your data with you.",
    },
    {
      heading: "The fine print, in plain words",
      body: "To the extent the law allows, Hearth isn't liable for indirect damages, things like lost data from an outage or what another user says or does, and our total liability to you is limited to the amount you have paid us, which for the free service is nothing. If something you do on Hearth causes a legal claim against us, for example posting something you didn't have the right to post, you agree to cover the reasonable cost of dealing with it. Nothing in these terms takes away rights the law guarantees you, and if any part of these terms turns out to be unenforceable, the rest still stands.",
    },
    {
      heading: "Which law applies",
      body: "These terms are governed by the laws of California, without regard to its conflict of laws rules, and any dispute goes to the state or federal courts located in Yolo County, California. If you live somewhere whose law gives you the right to bring a claim locally, this doesn't take that away.",
    },
    {
      heading: "Changes to these terms",
      body: "If we update these terms, we'll change the date at the top, and for anything significant we'll let you know in the app before it takes effect. Continuing to use Hearth after that means you accept the update.",
    },
    {
      heading: "Talk to us",
      body: "Hearth is operated by Raghav Kedia, doing business as Hearth, 625 Cantrill Dr, Apt 345, Davis, CA 95618. Questions about these terms, or something that doesn't seem right? Email hello@uhearth.app. A human reads it.",
    },
  ],
};

export const PRIVACY_POLICY: LegalDoc = {
  title: "Privacy Policy",
  updated: "August 2026",
  sections: [
    {
      heading: "The short version",
      body: "We collect what Hearth needs to work and nothing more. Your data is never sold, never used for advertising, and never shared with your university. Everything you post stays inside your verified campus, and you can delete your account, and everything in it, right from the app.",
    },
    {
      heading: "What you give us",
      body: "When you sign up we ask for your university email address, a password, and a display name. Your password is stored only in protected, encrypted form. We never see it. Your handle starts out as the part of your email address before the @, it's visible to your campus, and you can change it to anything you like in Account. Everything else on your profile is optional and up to you: major, graduation year, bio, photo. We never ask for your phone number.",
    },
    {
      heading: "What you create",
      body: "Your course list (entered by you, never pulled from your school), plus the channels and clubs you join, and the things you share: messages and direct messages, notes and files, events and RSVPs, polls and reactions. We store this so your classmates can see it. That's the product.",
    },
    {
      heading: "The things only you can see",
      body: "Some of what you type is stored for you alone, and no classmate, no moderator and nobody at your university can read it. Your grade estimator is the main one: the categories, weights and marks you enter to work out where you stand. It's your own note to yourself, kept private by the database itself, and it is not a school record. Your blocked list, your saved messages and your flashcard review history work the same way. All of it is deleted with your account.",
    },
    {
      heading: "Safety and device data",
      body: "If you report something or block someone, we keep a record so we can act on the report and keep the block working. A report is read by a moderator, who at most schools is a student at your own. They see the message or profile you reported and who wrote it, and nothing else about your account. Blocks are never shown to anyone but you. If you turn on notifications, we store a push token, the delivery address your device gives us, which you can switch off any time. We also keep routine technical records, like the timestamps behind our rate limits, to keep Hearth healthy.",
    },
    {
      heading: "What we never collect",
      body: "We don't connect to your university's systems, so no official record of yours reaches us: not your transcript, not your real class roster, not your enrollment, not your student ID. Anything about your coursework on Hearth is there because you typed it. We don't track your location, we don't read your contacts, we don't ask for your phone number, and there are no advertising trackers or analytics SDKs anywhere in Hearth.",
    },
    {
      heading: "Who can see what",
      body: "Course chats are visible only to classmates who added the same course. Campus channels are visible only to verified students at your school. Club spaces are for their members, and direct messages are for the people in that thread: just the two of you, or, in a named group, everyone in it (up to 16). Your profile is visible to your campus; turn Public profile off and classmates see only your handle and your photo. Nothing you write on Hearth is reachable from the wider internet. The one exception is your profile photo, which is served from a public link, so anyone who has that link can open it without signing in. Someone you block can't message you, and the things they write stay out of your view: messages, board posts, the line on their study session. They're never told, and nothing in Hearth will tell them.",
    },
    {
      heading: "How we use your data",
      body: "To run Hearth: showing the right content to the right classmates, delivering your messages and notifications, and keeping the community safe by reviewing reports and enforcing blocks and rate limits. That's it: no ad targeting, no marketing profiles, no selling.",
    },
    {
      heading: "Where your data lives",
      body: "Hearth's database and uploaded files are hosted with Supabase, our infrastructure provider, in a data center in Oregon in the United States. Data is encrypted in transit and at rest, and access rules are enforced at the database level, so a direct message, for example, can only ever be read by the people in that thread: the two of you in a one-to-one, or everyone in a group. If you're using Hearth from outside the United States, including from the UK or the EU, your data is transferred to and stored in the US, under the data processing terms we have in place with our host.",
    },
    {
      heading: "How long we keep things",
      body: "Your account and what's in it stay for as long as your account does. Delete the account and it all goes at once. Messages you delete are gone from the app straight away, though a copy can sit in our host's routine backups for a short while before it is overwritten. Reports and the record of a block are kept while your account exists, because a block that forgets itself isn't a block, and a moderator needs to see whether a pattern is repeating. Routine technical records, like the timestamps behind our rate limits, are kept for 90 days.",
    },
    {
      heading: "When we share",
      body: "We never sell your data, full stop. We share it only with the services that make Hearth run (Supabase for hosting and Expo for delivering push notifications) and only as needed for them to do that job. Beyond that, we would disclose data only if the law requires it or it's necessary to prevent serious harm to someone.",
    },
    {
      heading: "Deleting your data",
      body: "You're in control: edit or clear your profile any time, drop courses, and leave channels whenever you like. Removing your profile photo deletes the file, not just the link to it. Deleting your account, from Settings, then Delete account, removes everything at once: profile, messages, files, courses, blocks, and push tokens, immediately and permanently. There's no recovery window and no archive. The one thing that outlives it is a message of yours a classmate forwarded somewhere else: that copy is their message now, and it keeps the text with your name taken off it.",
    },
    {
      heading: "Your rights over your data",
      body: "Wherever you live: you can see everything we hold about you (Settings, then Your data, gives you one file), correct it, or delete all of it from Settings without asking us first. If you'd rather we did any of it, email hello@uhearth.app and we'll answer within 30 days. We don't sell your data and we never have, we don't share it for advertising, and there's nothing to opt out of because none of it happens. If you're in the UK or the EU, our legal basis for handling your data is that we need it to provide the service you signed up for, and for safety features it's our legitimate interest in keeping the community safe. You can also object to how we use it, ask us to restrict it, and complain to your national data protection authority. If you're in California, the rights to know, delete, correct and not be discriminated against for asking are the same ones described here, and you can use them the same way.",
    },
    {
      heading: "Age",
      body: "Hearth is for people 16 and older who are enrolled at or affiliated with a supported university. We don't knowingly collect data from anyone under 16, and if we learn that we have, we'll delete the account and everything in it. If you're a parent or guardian and think your child has an account, email hello@uhearth.app and we'll take care of it.",
    },
    {
      heading: "Changes to this policy",
      body: "If this policy changes, we'll update the date at the top, and for anything significant we'll let you know in the app before it takes effect.",
    },
    {
      heading: "Talk to us",
      body: "The controller of your data is Raghav Kedia, doing business as Hearth, 625 Cantrill Dr, Apt 345, Davis, CA 95618. Questions about your data, or a request we can help with? Email hello@uhearth.app. A human reads it.",
    },
  ],
};

export const COMMUNITY_GUIDELINES: LegalDoc = {
  title: "Community Guidelines",
  updated: "August 2026",
  sections: [
    {
      heading: "Why these exist",
      body: "Hearth is your campus, the same people you sit next to in lecture. These guidelines keep it a place worth showing up to, and they apply everywhere on Hearth: course chats, campus channels, clubs, events, direct messages, notes, and profiles.",
    },
    {
      heading: "Be a good classmate",
      body: "The bar is simple: treat people here the way you'd treat them across a table in the dining hall. Debate ideas as hard as you like, but aim at the idea, not the person.",
    },
    {
      heading: "No harassment or bullying",
      body: "Don't insult, threaten, or pile onto people, and don't keep contacting someone who's asked you to stop. If someone blocks you, respect it. Trying to reach them another way counts as harassment.",
    },
    {
      heading: "No hate",
      body: "Attacking people for who they are has no place here: race, ethnicity, religion, gender, sexual orientation, disability, or anything else about their identity. Not in channels, not in DMs, not as a joke.",
    },
    {
      heading: "No threats, ever",
      body: "Never threaten anyone with violence or wish harm on them. A threat reads the same whether or not you meant it, so we treat every one the same way: the content comes down, the account goes with it, and if we believe someone is in real danger we contact campus or local authorities.",
    },
    {
      heading: "Be yourself",
      body: "Use your own name or a handle your classmates know you by. Don't impersonate other students, professors, clubs, or Hearth itself, and stick to one account. If an account of yours was banned, coming back on a fresh one is not a fresh start; evading a ban just closes the new account too.",
    },
    {
      heading: "No spam or scams",
      body: "Selling your old textbook in asks-and-offers is great. Blasting every channel with the same message, pushing get-rich schemes, phishing for logins, or advertising at your classmates is not.",
    },
    {
      heading: "Keep it appropriate",
      body: "No sexual content on Hearth. This is a campus community and it includes students under 18. Anything sexualizing a minor is removed, the account is banned, and we report it to the National Center for Missing and Exploited Children as the law requires.",
    },
    {
      heading: "Take care of each other",
      body: "If someone talks about hurting themselves, take it seriously. Report it with the self-harm category so we see it quickly, and encourage them toward campus counseling or the 988 Suicide & Crisis Lifeline, which you can call or text at 988, any time. Raising a concern never gets anyone in trouble. The same care applies to content: posts that glorify, encourage, or make light of suicide, self-injury, or eating disorders come down.",
    },
    {
      heading: "Keep your work honest",
      body: "Sharing notes, forming study groups, and walking each other through a tough problem set is exactly what Hearth is for. Uploading exam answers, doing someone's assignment for them, or organizing plagiarism is not. Your school's academic integrity policy applies to what you do here, and so do we. The same goes for other people's work: your own notes are yours to share, but a scanned textbook chapter or a professor's slide deck is theirs. Owners can ask us to take material down, and accounts that keep infringing are closed.",
    },
    {
      heading: "Respect people's privacy",
      body: "Don't share anyone's personal information (address, phone number, schedule, photos) without their okay, and don't screenshot private conversations to embarrass someone. What classmates share inside Hearth stays in its room.",
    },
    {
      heading: "What happens when rules break",
      body: "Some enforcement is automatic: slurs are flagged the moment they're posted and land in the review queue on their own (swearing never trips that filter; slurs always do). Beyond that, every report is read by a person. We aim to get to all of them within a day, and safety reports go to the front of the queue. Depending on what we find, we remove content, warn people, or suspend or ban accounts, and serious things like hate, threats, or sexualizing minors mean an immediate ban. Reporting is protected in both directions: filing false reports to pile onto a classmate is itself a violation. We'd rather teach than punish, but we'll always protect the community first.",
    },
    {
      heading: "Report it",
      body: "See something that breaks these guidelines? Long-press any message and choose Report. Pick the closest category, add a note if you like, and we'll take it from there, usually within a day. You can also report or block someone from their profile; blocking is instant and silent, and you can manage your list any time under Settings → Blocked people.",
    },
  ],
};
