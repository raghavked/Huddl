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
  ListChecks,
  MailCheck,
  MapPin,
  MessagesSquare,
  Plus,
  Send,
  Users,
} from "lucide-react";
import { LogoMark, Wordmark } from "@/components/logo";
import { buttonClasses, cardClasses } from "@/components/ui";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Marketing landing page — the hearth (UI v3) front porch. Server     */
/* component; the only interactivity is the FAQ, which uses native     */
/* <details> so no client JS is needed.                                */
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
    q: "How do my course channels get set up?",
    a: "You add your classes yourself — type a course code and its chat opens, with the campus catalog autocompleting codes and titles as you go. If a class isn't in the catalog yet, adding it makes you its first member, and classmates who add the same class land right beside you.",
  },
  {
    q: "Does Huddl connect to my school's systems?",
    a: "No. Your course list on Huddl is yours alone — you add classes, rename nothing behind your back, and drop them whenever you like. Nothing links to your school accounts, and we never see your grades, submissions, or official enrollment.",
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
      {/* Sticky header — frosted glass                               */}
      {/* ---------------------------------------------------------- */}
      <header className="glass sticky top-0 z-40 border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            aria-label="Huddl home"
          >
            <Wordmark />
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1.5 sm:gap-2">
            <Link
              href="/login"
              className={buttonClasses({ variant: "ghost", size: "sm" })}
            >
              Log in
            </Link>
            <Link href="/signup" className={buttonClasses({ size: "sm" })}>
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
          {/* Quiet ambient washes — warm hearth tones, tokens only. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-linear-to-b from-brand/8 via-transparent to-transparent"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 right-[-10%] size-80 rounded-full bg-accent/8 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-24 top-40 size-80 rounded-full bg-brand-2/10 blur-3xl"
          />

          <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pt-24">
            <div className="mx-auto flex max-w-2xl animate-fade-up flex-col items-center text-center">
              <p className="text-sm font-medium text-muted">
                Now open at UC Davis — the UC system is next
              </p>
              <h1
                id="hero-heading"
                className="mt-6 text-4xl font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl"
              >
                Your campus, in{" "}
                <span className="relative inline-block">
                  one huddle
                  {/* Hand-drawn underline — one wobbly ember stroke. */}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 200 12"
                    preserveAspectRatio="none"
                    fill="none"
                    className="absolute -bottom-[0.08em] left-0 h-[0.16em] w-full"
                  >
                    <path
                      d="M5 8c30-5 61-6.5 95-4.5 34 2 66 2.5 95 0"
                      className="stroke-brand"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                .
              </h1>
              <p className="mt-6 max-w-xl text-base text-muted text-pretty sm:text-lg">
                Course chat that opens the moment you add a class. Notes that
                outlive the group chat. Study sessions people actually show up
                to. All of it verified with your school email — so it&apos;s
                your campus, and only your campus.
              </p>
              <div className="mt-8 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
                <Link
                  href="/signup"
                  className={buttonClasses({
                    size: "lg",
                    className: "w-full sm:w-auto",
                  })}
                >
                  Join with your school email
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
                <Link
                  href="/login"
                  className={buttonClasses({
                    variant: "secondary",
                    size: "lg",
                    className: "w-full sm:w-auto",
                  })}
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

            {/* Hero collage: chat panel center, DM list + event card
                floating beside it on md+. Decorative, tokens only. */}
            <div
              aria-hidden="true"
              className="relative mx-auto mt-14 max-w-md select-none sm:mt-16 md:max-w-4xl"
            >
              <div className="pointer-events-none absolute inset-x-12 top-6 h-72 rounded-full bg-brand-2/15 blur-3xl" />
              <div className="relative z-10 mx-auto md:max-w-md">
                <ChatVignette />
              </div>
              <div className="absolute top-8 hidden w-72 -rotate-2 md:-left-2 md:block lg:left-4">
                <DmVignette />
              </div>
              <div className="absolute top-24 hidden w-72 rotate-2 md:-right-2 md:block lg:right-4">
                <EventVignette />
              </div>
            </div>

            {/* Supported-schools strip */}
            <div className="mt-16">
              <h2 className="text-center text-sm font-semibold text-muted">
                Rolling out across the UC system
              </h2>
              <ul className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {SCHOOLS.map((school) => (
                  <li
                    key={school}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted shadow-soft"
                  >
                    <GraduationCap
                      aria-hidden="true"
                      className="size-3.5 text-brand"
                    />
                    {school}
                  </li>
                ))}
                <li className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted">
                  <Plus aria-hidden="true" className="size-3.5 text-accent" />
                  Your school next
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/* Stats strip — honest, token-built                         */}
        {/* -------------------------------------------------------- */}
        <section
          aria-label="Huddl at a glance"
          className="mx-auto w-full max-w-5xl px-4 sm:px-6"
        >
          <dl
            className={cardClasses({
              padding: "none",
              className:
                "grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0",
            })}
          >
            <div className="flex flex-col gap-1 px-6 py-5 text-center">
              <dt className="order-2 text-xs text-muted">
                so every community starts dense, not empty
              </dt>
              <dd className="order-1 text-lg font-bold tracking-tight sm:text-xl">
                One campus at a time
              </dd>
            </div>
            <div className="flex flex-col gap-1 px-6 py-5 text-center">
              <dt className="order-2 text-xs text-muted">
                the core of Huddl, staying that way
              </dt>
              <dd className="order-1 text-lg font-bold tracking-tight sm:text-xl">
                Free for students
              </dd>
            </div>
            <div className="flex flex-col gap-1 px-6 py-5 text-center">
              <dt className="order-2 text-xs text-muted">
                in course channels, ever
              </dt>
              <dd className="order-1 text-lg font-bold tracking-tight sm:text-xl">
                0 ads
              </dd>
            </div>
          </dl>
        </section>

        {/* -------------------------------------------------------- */}
        {/* Features — bento grid                                     */}
        {/* -------------------------------------------------------- */}
        <section
          aria-labelledby="features-heading"
          className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24"
        >
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="features-heading"
              className="text-3xl font-bold tracking-tight text-balance sm:text-4xl"
            >
              Everything your semester runs on
            </h2>
            <p className="mt-4 text-muted text-pretty">
              One place for the conversations, files and plans that usually get
              scattered across five apps and a dozen group chats.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2">
            <FeatureCard
              icon={BookOpen}
              title="Your classes, added in seconds"
              body="Type a course and its chat opens; the campus catalog autocompletes the details. Your classmates are already in it, because they added the same classes — and if you're first, the room is ready for whoever's next."
              points={[
                "One chat per course, open the moment you add it",
                "The campus catalog fills in codes and titles as you type",
                "Drop a class and the channel quietly lets you go",
              ]}
              vignette={<SyncVignette />}
            />
            <FeatureCard
              icon={FileText}
              title="Notes that don't die in group chats"
              body="Week 5 slides shouldn't be 400 messages deep in someone else's thread. On Huddl, notes live with the course — uploader credit, one tap to download, there for everyone all term."
              points={[
                "Files attach to the course, not to a conversation",
                "Whoever shared it gets the credit, always",
                "Still there during finals week, exactly where you left it",
              ]}
              vignette={<NotesVignette />}
            />
            <FeatureCard
              icon={CalendarDays}
              title="Plans people actually show up to"
              body="Spin up a review session before the midterm, a club meetup, or a Sunday pickup game. RSVPs, capacity and location up front — so you know who's in before you head out."
              points={[
                "RSVP with one tap, see who else is going",
                "Cap the room when the study spot only fits six",
                "Tied to your courses and clubs, visible to the right people",
              ]}
              vignette={<EventMiniVignette />}
            />
            <FeatureCard
              icon={MessagesSquare}
              title="Your whole campus, on speaking terms"
              body="Trade notes over DMs, find your people in #study-buddies, pass on a textbook in #asks-and-offers. Every campus starts with places to talk — and students open new channels from there."
              points={[
                "1:1 messages with read state and real-time delivery",
                "Campus channels every student is part of from day one",
                "Student-created channels for everything else",
              ]}
              vignette={<CampusVignette />}
            />
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/* Trust / verification — accent-led                         */}
        {/* -------------------------------------------------------- */}
        <section
          aria-labelledby="trust-heading"
          className="relative border-y border-border/60 bg-surface"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-linear-to-b from-accent/5 to-transparent"
          />
          <div className="relative mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
            <div className="mx-auto max-w-2xl text-center">
              <h2
                id="trust-heading"
                className="text-3xl font-bold tracking-tight text-balance sm:text-4xl"
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
                icon={ListChecks}
                title="Your courses, run by you"
                body="You add your own classes — nothing connects to your school's systems, and nothing about your schedule is collected behind your back. Course chats are visible only to classmates who added the same class."
              />
              <TrustStep
                step={3}
                icon={BellRing}
                title="Campus-only, receipts included"
                body="Everything you post stays inside your verified campus. And where privacy matters most, we show you the log — audited events become notifications by database trigger, so nothing happens silently."
              />
            </ol>
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/* FAQ                                                       */}
        {/* -------------------------------------------------------- */}
        <section
          aria-labelledby="faq-heading"
          className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24"
        >
          <div className="text-center">
            <h2
              id="faq-heading"
              className="text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Questions, answered
            </h2>
          </div>
          <div className="mt-10 flex flex-col gap-3">
            {FAQS.map((faq) => (
              <details
                key={faq.q}
                className="group rounded-card border border-border bg-surface transition-all open:border-brand/40 open:shadow-soft"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-card px-5 py-4 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:text-base [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted transition-all group-open:rotate-90 group-open:bg-brand-soft group-open:text-brand">
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </span>
                </summary>
                <p className="px-5 pb-5 text-sm leading-relaxed text-muted">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/* Closing CTA — one calm ember panel                        */}
        {/* -------------------------------------------------------- */}
        <section
          aria-labelledby="cta-heading"
          className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6"
        >
          <div className="rounded-card bg-brand px-6 py-14 text-center shadow-lift sm:px-12 sm:py-20">
            <LogoMark className="mx-auto size-10 text-brand-fg" />
            <h2
              id="cta-heading"
              className="mt-4 text-2xl font-bold tracking-tight text-balance text-brand-fg sm:text-4xl"
            >
              Your classmates are one huddle away
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-brand-fg sm:text-base">
              It takes your school email and about a minute. Add your classes
              and each one&apos;s chat opens right up.
            </p>
            <Link
              href="/signup"
              className="mt-8 inline-flex select-none items-center justify-center gap-2 rounded-full bg-surface px-7 py-3.5 text-base font-semibold text-foreground shadow-lift transition-all hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-fg active:scale-[0.98]"
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
      <footer className="border-t border-border/60 bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6">
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
                className={buttonClasses({ variant: "ghost", size: "sm" })}
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className={buttonClasses({ variant: "soft", size: "sm" })}
              >
                Sign up
              </Link>
            </nav>
          </div>
          <div className="flex flex-col gap-2 border-t border-border/60 pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
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
/* Feature card for the bento grid.                                    */
/* ------------------------------------------------------------------ */

function FeatureCard({
  icon: Icon,
  title,
  body,
  points,
  vignette,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  points: string[];
  vignette: React.ReactNode;
}) {
  return (
    <article
      className={cardClasses({ padding: "lg", className: "flex flex-col" })}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Icon aria-hidden className="size-5" />
      </span>
      <h3 className="mt-4 text-xl font-bold tracking-tight text-balance">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted text-pretty">
        {body}
      </p>
      <ul className="mt-4 flex flex-col gap-2">
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
      <div aria-hidden="true" className="mt-auto select-none pt-6">
        {vignette}
      </div>
    </article>
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
    <li className="flex flex-col gap-3 rounded-card border border-border bg-background p-5 shadow-soft sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon aria-hidden className="size-5" />
        </span>
        <span className="text-xs font-semibold text-muted">Step {step}</span>
      </div>
      <h3 className="text-base font-bold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted">{body}</p>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Vignettes: fake-UI panels built purely from tokens.                 */
/* Decorative — hidden from assistive tech.                            */
/* ------------------------------------------------------------------ */

function VignetteFrame({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "select-none rounded-card border border-border/70 bg-surface p-4 shadow-lift sm:p-5",
        className
      )}
    >
      {children}
    </div>
  );
}

function FakeAvatar({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
        accent ? "bg-accent-soft text-accent" : "bg-brand-soft text-brand-ink"
      )}
    >
      {label}
    </span>
  );
}

/** Hero center panel: a course channel with its composer. */
function ChatVignette() {
  return (
    <VignetteFrame>
      <div className="flex items-center gap-2.5 border-b border-border/70 pb-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Hash className="size-4" />
        </span>
        <span className="text-sm font-bold">econ-101a</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
          <Users className="size-3" />
          18 classmates in
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
        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-surface-2 px-3.5 py-2 shadow-soft">
          <span className="flex-1 text-xs text-muted">Message #econ-101a…</span>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg">
            <Send className="size-3" />
          </span>
        </div>
      </div>
    </VignetteFrame>
  );
}

/** Hero left panel: the DM inbox. */
function DmVignette() {
  return (
    <VignetteFrame className="p-3.5 sm:p-4">
      <div className="flex items-center justify-between border-b border-border/70 pb-2.5">
        <span className="text-[11px] font-bold text-muted">Messages</span>
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand-ink">
          2 new
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        <div className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-2.5 py-2">
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
        <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2">
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
        <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2">
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
    </VignetteFrame>
  );
}

/** Hero right panel: an event card with RSVPs. */
function EventVignette() {
  return (
    <VignetteFrame className="p-3.5 sm:p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-xl bg-accent-soft text-accent">
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
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-brand-fg shadow-soft">
          <Check className="size-3.5" />
          I&apos;m in
        </span>
      </div>
    </VignetteFrame>
  );
}

/* --- Compact vignettes for the feature bento cards. --- */

/** Course list growing as you add classes — catalog fills in the details. */
function SyncVignette() {
  const rows = [
    {
      slug: "econ-101a",
      tag: "Added by you",
      tagClass: "bg-brand-soft text-brand-ink",
    },
    {
      slug: "phys-9b",
      tag: "From the catalog",
      tagClass: "bg-success/10 text-success",
    },
    {
      slug: "cs-61b",
      tag: "You're the first",
      tagClass: "bg-surface-2 text-muted",
    },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <div
          key={row.slug}
          className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background px-3 py-2"
        >
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
            <Hash className="size-3.5 shrink-0 text-brand" />
            <span className="truncate">{row.slug}</span>
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              row.tagClass
            )}
          >
            {row.tag}
          </span>
        </div>
      ))}
    </div>
  );
}

/** File rows that live with the course. */
function NotesVignette() {
  const files = [
    { name: "Week 5 lecture notes.pdf", meta: "maya · 1.2 MB" },
    { name: "Midterm study guide.pdf", meta: "dev · 840 KB" },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      {files.map((file) => (
        <div
          key={file.name}
          className="flex items-center gap-3 rounded-xl border border-border/60 bg-background px-3 py-2"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
            <FileText className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{file.name}</p>
            <p className="text-[10px] text-muted">{file.meta}</p>
          </div>
          <ArrowRight className="size-3.5 shrink-0 -rotate-45 text-muted" />
        </div>
      ))}
    </div>
  );
}

/** A compact study-session card with RSVPs. */
function EventMiniVignette() {
  return (
    <div className="rounded-xl border border-border/60 bg-background p-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 flex-col items-center justify-center rounded-xl bg-accent-soft text-accent">
          <span className="text-[8px] font-bold uppercase leading-none">
            Sun
          </span>
          <span className="text-xs font-bold leading-tight">17</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold">CHEM 2B study group</p>
          <p className="text-[10px] text-muted">
            Sun · 3:00 PM · 24-hr study room
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <div className="flex -space-x-1.5">
          <FakeAvatar label="MJ" />
          <FakeAvatar label="SR" accent />
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-surface-3 text-[10px] font-bold text-muted">
            +4
          </span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 text-[10px] font-semibold text-brand-fg">
          <Check className="size-3" />
          I&apos;m in
        </span>
      </div>
    </div>
  );
}

/** Campus channel chips plus a fresh DM. */
function CampusVignette() {
  return (
    <div className="rounded-xl border border-border/60 bg-background p-3">
      <div className="flex flex-wrap gap-1.5">
        {["general", "study-buddies", "asks-and-offers"].map((slug, i) => (
          <span
            key={slug}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold",
              i === 1 ? "bg-brand-soft text-brand-ink" : "bg-surface-2 text-muted"
            )}
          >
            <Hash className="size-3" />
            {slug}
          </span>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2.5 rounded-xl bg-surface px-3 py-2 shadow-soft">
        <FakeAvatar label="MJ" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">
            maya <span className="font-normal text-muted">· now</span>
          </p>
          <p className="truncate text-[11px] text-muted">
            quiet floor of the library, 7pm — who&apos;s in?
          </p>
        </div>
        <span className="size-2 shrink-0 rounded-full bg-brand" />
      </div>
    </div>
  );
}
