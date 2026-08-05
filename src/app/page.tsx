import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BellRing,
  BookOpen,
  CalendarDays,
  Check,
  Clock,
  FileText,
  GraduationCap,
  Hash,
  MailCheck,
  MapPin,
  MessagesSquare,
  ScanLine,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { LogoMark, Wordmark } from "@/components/logo";

/* ------------------------------------------------------------------ */
/* Marketing landing page. Server component — the only interactivity   */
/* is the FAQ, which uses native <details> so no client JS is needed.  */
/* ------------------------------------------------------------------ */

const SCHOOLS = [
  "UC Davis",
  "UC Berkeley",
  "UCLA",
  "UC San Diego",
  "UC Irvine",
  "UC Santa Barbara",
  "UC Santa Cruz",
  "UC Riverside",
  "UC Merced",
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Who can join Huddl?",
    a: "Anyone with a student email at a supported school. You sign up with your @school.edu address, confirm it from your inbox, and you land in your campus — and only your campus. There are no open servers and no cross-campus browsing.",
  },
  {
    q: "Which schools are supported?",
    a: "We open one campus at a time so every community starts dense, not empty. UC Davis is first, followed by the rest of the UC system, then the CSUs. If your school isn't live yet, signing up with your school email is the best way to move it up the list — a campus opens once enough students are waiting.",
  },
  {
    q: "What does Huddl read from Canvas?",
    a: "Only your course list — course codes, titles, and the current term — so we can drop you into the right channels. We never touch grades, submissions, or assignments, and you can disconnect Canvas at any time without losing your channels.",
  },
  {
    q: "What happens to the photo of my schedule?",
    a: "It's read in your browser, on your device, to suggest your courses — nothing is uploaded during that step. You confirm the courses before anything is saved. If you choose to store the image for your records, every single access to it is logged and shows up in your notifications. That audit trail is enforced by the database itself, not by policy.",
  },
  {
    q: "Can professors or administrators see my messages?",
    a: "No. Huddl is a student space. Course channels are visible only to students enrolled in that course, campus channels only to verified students at your school, and DMs only to the two people in them.",
  },
  {
    q: "How much does it cost?",
    a: "Nothing. The core of Huddl — course channels, campus channels, DMs, notes, and events — is free for students, and staying that way. We will never sell student data and never put ads inside course channels.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-fg"
      >
        Skip to content
      </a>

      {/* ---------------------------------------------------------- */}
      {/* Sticky header                                                */}
      {/* ---------------------------------------------------------- */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            aria-label="Huddl home"
          >
            <Wordmark />
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-sm font-semibold text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Join
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {/* -------------------------------------------------------- */}
        {/* Hero                                                      */}
        {/* -------------------------------------------------------- */}
        <section
          aria-labelledby="hero-heading"
          className="relative overflow-hidden"
        >
          {/* Decorative wash built from token colors only. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-linear-to-b from-brand/10 via-transparent to-transparent"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 right-[-10%] size-72 rounded-full bg-accent/10 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-24 top-40 size-72 rounded-full bg-brand/10 blur-3xl"
          />

          <div className="relative mx-auto max-w-5xl px-4 pb-14 pt-14 sm:px-6 sm:pt-20">
            <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
              <p className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3.5 py-1.5 text-xs font-semibold text-brand-strong">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-brand"
                />
                Now open at UC Davis — the UC system is next
              </p>
              <h1
                id="hero-heading"
                className="mt-5 text-4xl font-bold tracking-tight text-balance sm:text-5xl md:text-6xl"
              >
                Your campus, in one huddle.
              </h1>
              <p className="mt-5 max-w-xl text-base text-muted text-pretty sm:text-lg">
                Course chat that sets itself up from your schedule. Notes that
                outlive the group chat. Study sessions people actually show up
                to. All of it verified with your school email — so it&apos;s
                your campus, and only your campus.
              </p>
              <div className="mt-8 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
                <Link
                  href="/signup"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-brand-fg shadow-sm transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:w-auto"
                >
                  Join with your school email
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex w-full items-center justify-center rounded-full border border-border bg-surface px-7 py-3.5 text-base font-semibold transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:w-auto"
                >
                  I have an account
                </Link>
              </div>
              <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-muted">
                <li className="inline-flex items-center gap-1.5">
                  <Check aria-hidden="true" className="size-3.5 text-success" />
                  Free for students
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <Check aria-hidden="true" className="size-3.5 text-success" />
                  Your campus only
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <Check aria-hidden="true" className="size-3.5 text-success" />
                  No ads in course channels
                </li>
              </ul>
            </div>

            {/* Supported-schools strip */}
            <div className="mt-12">
              <h2 className="text-center text-xs font-semibold uppercase tracking-widest text-muted">
                Rolling out across the UC system
              </h2>
              <ul className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {SCHOOLS.map((school) => (
                  <li
                    key={school}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted"
                  >
                    <GraduationCap
                      aria-hidden="true"
                      className="size-3.5 text-brand"
                    />
                    {school}
                  </li>
                ))}
                <li className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted">
                  <Sparkles aria-hidden="true" className="size-3.5 text-accent" />
                  Your school next
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/* Features                                                  */}
        {/* -------------------------------------------------------- */}
        <section
          aria-labelledby="features-heading"
          className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20"
        >
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand">
              Why Huddl
            </p>
            <h2
              id="features-heading"
              className="mt-2 text-3xl font-bold tracking-tight text-balance sm:text-4xl"
            >
              Everything your semester runs on
            </h2>
            <p className="mt-4 text-muted text-pretty">
              One place for the conversations, files and plans that usually get
              scattered across five apps and a dozen group chats.
            </p>
          </div>

          <div className="mt-14 flex flex-col gap-16 sm:gap-20">
            {/* Feature 1 — Course channels from Canvas */}
            <FeatureRow
              icon={BookOpen}
              kicker="Course channels"
              title="Synced straight from Canvas"
              body="Connect Canvas — or snap a photo of your schedule — and a channel for every one of your classes is waiting for you. Your classmates are already in it, because their schedules put them there too."
              points={[
                "One channel per course, created automatically",
                "Drop a class and the channel quietly lets you go",
                "Manual course picking if you'd rather not connect anything",
              ]}
              illustration={<CourseChannelIllustration />}
            />

            {/* Feature 2 — Notes */}
            <FeatureRow
              flip
              icon={FileText}
              kicker="Notes"
              title="Notes that don't die in group chats"
              body="Week 5 slides shouldn't be 400 messages deep in someone else's thread. On Huddl, notes live with the course — uploader credit, one tap to download, there for everyone all term."
              points={[
                "Files attach to the course, not to a conversation",
                "Whoever shared it gets the credit, always",
                "Still there during finals week, exactly where you left it",
              ]}
              illustration={<NotesIllustration />}
            />

            {/* Feature 3 — Study sessions & meetups */}
            <FeatureRow
              icon={CalendarDays}
              kicker="Study sessions & meetups"
              title="Plans people actually show up to"
              body="Spin up a review session before the midterm, a club meetup, or a Sunday pickup game. RSVPs, capacity and location up front — so you know who's in before you head out."
              points={[
                "RSVP with one tap, see who else is going",
                "Cap the room when the study spot only fits six",
                "Tied to your courses and clubs, visible to the right people",
              ]}
              illustration={<EventIllustration />}
            />

            {/* Feature 4 — DMs and campus channels */}
            <FeatureRow
              flip
              icon={MessagesSquare}
              kicker="DMs & campus channels"
              title="Your whole campus, on speaking terms"
              body="Trade notes over DMs, find your people in #study-buddies, pass on a textbook in #asks-and-offers. Every campus starts with places to talk — and students open new channels from there."
              points={[
                "1:1 messages with read state and real-time delivery",
                "Campus channels every student is part of from day one",
                "Student-created channels for everything else",
              ]}
              illustration={<DmIllustration />}
            />
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/* Trust / verification                                      */}
        {/* -------------------------------------------------------- */}
        <section
          aria-labelledby="trust-heading"
          className="border-y border-border bg-surface"
        >
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-accent">
                <ShieldCheck aria-hidden="true" className="size-4" />
                Built on trust
              </p>
              <h2
                id="trust-heading"
                className="mt-2 text-3xl font-bold tracking-tight text-balance sm:text-4xl"
              >
                How verification works
              </h2>
              <p className="mt-4 text-muted text-pretty">
                A campus community only works if everyone in it is actually on
                your campus — and if you can see exactly what happens with your
                data.
              </p>
            </div>

            <ol className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-3">
              <TrustStep
                step={1}
                icon={MailCheck}
                title="Your school email is your key"
                body="Sign up with your @school.edu address and confirm it from your inbox. That's what puts you on your campus — and keeps everyone else off it."
              />
              <TrustStep
                step={2}
                icon={ScanLine}
                title="Your schedule stays on your device"
                body="A photo of your schedule is read in your browser to suggest courses. You confirm them before anything is saved — the reading itself never leaves your device."
              />
              <TrustStep
                step={3}
                icon={BellRing}
                title="Notified access, always"
                body="Choose to store the image, and every access to it is logged and lands in your notifications. The database enforces it — it isn't a policy, it's a trigger."
              />
            </ol>
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/* FAQ                                                       */}
        {/* -------------------------------------------------------- */}
        <section
          aria-labelledby="faq-heading"
          className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-20"
        >
          <h2
            id="faq-heading"
            className="text-center text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Questions, answered
          </h2>
          <div className="mt-10 flex flex-col gap-3">
            {FAQS.map((faq) => (
              <details
                key={faq.q}
                className="group rounded-card border border-border bg-surface open:border-brand/40"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-card px-5 py-4 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:text-base [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted transition-transform group-open:rotate-90"
                  />
                </summary>
                <p className="px-5 pb-5 text-sm leading-relaxed text-muted">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/* Closing CTA                                               */}
        {/* -------------------------------------------------------- */}
        <section
          aria-labelledby="cta-heading"
          className="mx-auto w-full max-w-5xl px-4 pb-20 sm:px-6"
        >
          <div className="relative overflow-hidden rounded-card border border-border bg-linear-to-br from-brand/15 via-surface to-accent/10 px-6 py-12 text-center sm:px-12 sm:py-16">
            <LogoMark className="mx-auto size-10 text-brand" />
            <h2
              id="cta-heading"
              className="mt-4 text-2xl font-bold tracking-tight text-balance sm:text-3xl"
            >
              Your classmates are one huddle away
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted sm:text-base">
              It takes your school email and about a minute. Your course
              channels are already waiting.
            </p>
            <Link
              href="/signup"
              className="mt-7 inline-flex items-center justify-center gap-2 rounded-full bg-brand px-7 py-3.5 text-base font-semibold text-brand-fg shadow-sm transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Join with your school email
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      {/* ---------------------------------------------------------- */}
      {/* Footer                                                      */}
      {/* ---------------------------------------------------------- */}
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <Wordmark />
              <p className="mt-2 text-sm text-muted">
                Your campus, in one huddle.
              </p>
            </div>
            <nav aria-label="Footer" className="flex items-center gap-2">
              <Link
                href="/login"
                className="rounded-full px-4 py-2 text-sm font-semibold text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-full bg-brand-soft px-4 py-2 text-sm font-semibold text-brand-strong transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Sign up
              </Link>
            </nav>
          </div>
          <div className="flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
              Made for students, between classes. Never selling your data, never
              running ads in your course channels.
            </p>
            <p>&copy; {new Date().getFullYear()} Huddl</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feature row: text + illustration, alternating sides on md+.         */
/* ------------------------------------------------------------------ */

function FeatureRow({
  icon: Icon,
  kicker,
  title,
  body,
  points,
  illustration,
  flip = false,
}: {
  icon: LucideIcon;
  kicker: string;
  title: string;
  body: string;
  points: string[];
  illustration: React.ReactNode;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
      <div className={flip ? "md:order-2" : undefined}>
        <p className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand-strong">
          <Icon aria-hidden className="size-3.5" />
          {kicker}
        </p>
        <h3 className="mt-4 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
          {title}
        </h3>
        <p className="mt-3 leading-relaxed text-muted text-pretty">{body}</p>
        <ul className="mt-5 flex flex-col gap-2.5">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2.5 text-sm">
              <Check
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-success"
              />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={flip ? "md:order-1" : undefined}>{illustration}</div>
    </div>
  );
}

function TrustStep({
  step,
  icon: Icon,
  title,
  body,
}: {
  step: number;
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-card border border-border bg-background p-5">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon aria-hidden className="size-4.5" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-widest text-muted">
          Step {step}
        </span>
      </div>
      <h3 className="text-base font-bold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted">{body}</p>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Illustrations: small fake-UI vignettes built purely from tokens.    */
/* Decorative — hidden from assistive tech.                            */
/* ------------------------------------------------------------------ */

function IllustrationFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="select-none rounded-card border border-border bg-surface p-4 shadow-sm sm:p-5"
    >
      {children}
    </div>
  );
}

function FakeAvatar({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
        accent
          ? "bg-accent-soft text-accent"
          : "bg-brand-soft text-brand-strong"
      }`}
    >
      {label}
    </span>
  );
}

function CourseChannelIllustration() {
  return (
    <IllustrationFrame>
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <Hash className="size-4 text-muted" />
        <span className="text-sm font-bold">econ-101a</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
          <Check className="size-3" />
          Synced from Canvas
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-3.5">
        <div className="flex items-start gap-2.5">
          <FakeAvatar label="MJ" />
          <div>
            <p className="text-xs font-semibold">
              maya <span className="font-normal text-muted">2:14 PM</span>
            </p>
            <p className="mt-1 rounded-2xl rounded-tl-sm bg-surface-2 px-3 py-2 text-xs">
              wait, is the problem set due tonight or friday??
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <FakeAvatar label="DP" accent />
          <div>
            <p className="text-xs font-semibold">
              dev <span className="font-normal text-muted">2:15 PM</span>
            </p>
            <p className="mt-1 rounded-2xl rounded-tl-sm bg-surface-2 px-3 py-2 text-xs">
              friday — prof pushed it in lecture. notes are in the channel
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3.5 py-2">
          <span className="flex-1 text-xs text-muted">
            Message #econ-101a…
          </span>
          <Send className="size-3.5 text-brand" />
        </div>
      </div>
    </IllustrationFrame>
  );
}

function NotesIllustration() {
  const files = [
    { name: "Week 5 lecture notes.pdf", meta: "maya · 1.2 MB" },
    { name: "Midterm study guide.pdf", meta: "dev · 840 KB" },
    { name: "Ch. 7 problem walkthrough.pdf", meta: "sam · 2.1 MB" },
  ];
  return (
    <IllustrationFrame>
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <FileText className="size-4 text-muted" />
        <span className="text-sm font-bold">Notes · ECON 101A</span>
        <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand-strong">
          All term
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {files.map((file) => (
          <li
            key={file.name}
            className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5"
          >
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-strong">
              <FileText className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{file.name}</p>
              <p className="text-[10px] text-muted">{file.meta}</p>
            </div>
            <ArrowRight className="size-3.5 shrink-0 -rotate-45 text-muted" />
          </li>
        ))}
      </ul>
    </IllustrationFrame>
  );
}

function EventIllustration() {
  return (
    <IllustrationFrame>
      <div className="flex items-center gap-2">
        <span className="inline-flex size-10 shrink-0 flex-col items-center justify-center rounded-xl bg-brand-soft text-brand-strong">
          <span className="text-[9px] font-bold uppercase leading-none">
            Thu
          </span>
          <span className="text-sm font-bold leading-tight">14</span>
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">PHYS 9B midterm review</p>
          <p className="text-[11px] text-muted">Hosted by study-buddies</p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1.5 text-xs text-muted">
        <p className="flex items-center gap-2">
          <Clock className="size-3.5" /> Thu · 6:00–8:00 PM
        </p>
        <p className="flex items-center gap-2">
          <MapPin className="size-3.5" /> Library, 3rd floor, room 301
        </p>
        <p className="flex items-center gap-2">
          <Users className="size-3.5" /> 12 going · 8 spots left
        </p>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex -space-x-1.5">
          <FakeAvatar label="MJ" />
          <FakeAvatar label="DP" accent />
          <FakeAvatar label="SR" />
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-surface-3 text-[10px] font-bold text-muted">
            +9
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-brand-fg">
          <Check className="size-3.5" />
          I&apos;m in
        </span>
      </div>
    </IllustrationFrame>
  );
}

function DmIllustration() {
  return (
    <IllustrationFrame>
      <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
        {["general", "study-buddies", "campus-events", "asks-and-offers"].map(
          (slug, i) => (
            <span
              key={slug}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                i === 1
                  ? "bg-brand-soft text-brand-strong"
                  : "bg-surface-2 text-muted"
              }`}
            >
              <Hash className="size-3" />
              {slug}
            </span>
          ),
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5">
          <FakeAvatar label="SR" accent />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">
              sam <span className="font-normal text-muted">· now</span>
            </p>
            <p className="truncate text-[11px] text-muted">
              found a study group for tuesday — you in?
            </p>
          </div>
          <span className="size-2 shrink-0 rounded-full bg-brand" />
        </div>
        <div className="flex items-center gap-3 rounded-xl px-3.5 py-2.5">
          <FakeAvatar label="AL" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">
              ada <span className="font-normal text-muted">· 1h</span>
            </p>
            <p className="truncate text-[11px] text-muted">
              selling my chem textbook, half price for you
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl px-3.5 py-2.5">
          <FakeAvatar label="JT" accent />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">
              jordan <span className="font-normal text-muted">· 3h</span>
            </p>
            <p className="truncate text-[11px] text-muted">
              thanks for the notes — total lifesaver
            </p>
          </div>
        </div>
      </div>
    </IllustrationFrame>
  );
}
