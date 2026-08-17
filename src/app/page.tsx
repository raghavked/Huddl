import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Check,
  Coffee,
  FileText,
  MapPin,
  Send,
  Tag,
  Users,
} from "lucide-react";
import { LogoMark, Wordmark } from "@/components/logo";
import { buttonClasses } from "@/components/ui";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Marketing landing page, UC Davis edition. Server component; the     */
/* only interactivity is the FAQ, which uses native <details> so no    */
/* client JS is needed.                                                */
/*                                                                     */
/* The design brief, learned the hard way: this page used to look      */
/* machine-made. Centered everything, gradient blobs, a 2x2 grid of    */
/* identical icon cards with checkmark triads, "Step 1/2/3" chips, and */
/* copy that could have been about any school (it said "semester";     */
/* Davis is on quarters). The rewrite is left-aligned and editorial,   */
/* numbered feature rows that alternate sides, prose instead of        */
/* bullet-with-checkmark lists, and every example drawn from the       */
/* actual campus: real course codes, Shields, the CoHo, the quarter    */
/* system. One school, named everywhere, because that is the product.  */
/* ------------------------------------------------------------------ */

const FAQS: { q: string; a: string }[] = [
  {
    q: "Who can join Hearth?",
    a: "Anyone with a @ucdavis.edu email. You sign up, confirm from your inbox, and you land in the Davis campus. Nobody without that address gets in: no open servers, no browsing from outside, no lurkers.",
  },
  {
    q: "I'm not at UC Davis. Can I join?",
    a: "Not yet. Hearth is Davis-only on purpose: one campus where everyone actually goes here beats a hundred empty ones. Where it goes after Davis depends on how Davis goes.",
  },
  {
    q: "How do my course chats get set up?",
    a: "You add your classes yourself: type MAT 21B and its chat opens, and the campus catalog fills in codes and titles as you go. If a class isn't in the catalog yet, adding it makes you its first member, and classmates who add the same class land right beside you.",
  },
  {
    q: "Does Hearth connect to Canvas or Schedule Builder?",
    a: "No. Your course list on Hearth is yours alone: you add classes, we rename nothing behind your back, and you drop them whenever you like. Nothing links to your UC Davis accounts, and we never see your grades, submissions, or official enrollment.",
  },
  {
    q: "Can professors or administrators see my messages?",
    a: "No. Hearth is a student space. Course chats are visible only to students who added that course, campus channels only to verified Davis students, and a direct message only to the people in that thread: the two of you, or everyone in a group you started together.",
  },
  {
    q: "How much does it cost?",
    a: "Nothing. The core of Hearth (course chats, campus channels, DMs, notes, and events) is free for students, and staying that way. We will never sell student data and never put ads inside course chats.",
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
      {/* Header                                                      */}
      {/* ---------------------------------------------------------- */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            aria-label="Hearth home"
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
        {/* Hero: left-aligned, one honest screenshot-style panel     */}
        {/* -------------------------------------------------------- */}
        <section
          aria-labelledby="hero-heading"
          className="mx-auto w-full max-w-5xl px-4 pb-16 pt-12 sm:px-6 sm:pt-20"
        >
          <div className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr] md:gap-12">
            <div className="max-w-xl">
              <p className="text-sm font-semibold text-brand">
                For UC Davis students
              </p>
              <h1
                id="hero-heading"
                className="mt-4 text-4xl font-bold tracking-tight text-balance sm:text-5xl"
              >
                Every class at Davis, one chat away.
              </h1>
              <p className="mt-5 text-base leading-relaxed text-muted text-pretty sm:text-lg">
                Add MAT 21B and you&apos;re in its chat with everyone else who
                added it. The week 5 notes are still findable in week 10. The
                midterm review in Shields has a real headcount before you bike
                over. Verified with your @ucdavis.edu email, so it&apos;s
                Aggies and nobody else.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/signup"
                  className={buttonClasses({
                    size: "lg",
                    className: "w-full sm:w-auto",
                  })}
                >
                  Join with your @ucdavis.edu email
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
                <Link
                  href="/login"
                  className={buttonClasses({
                    variant: "ghost",
                    size: "lg",
                    className: "w-full sm:w-auto",
                  })}
                >
                  I have an account
                </Link>
              </div>
              <p className="mt-5 text-xs text-muted">
                Free for students. No ads in course chats. Davis only.
              </p>
            </div>

            <div aria-hidden="true" className="relative mx-auto w-full max-w-md">
              <ChatVignette />
              <div className="mt-4 hidden md:block">
                <EventVignette />
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/* Features: numbered editorial rows, alternating sides      */}
        {/* -------------------------------------------------------- */}
        <section
          aria-labelledby="features-heading"
          className="border-t border-border/60"
        >
          <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <h2
              id="features-heading"
              className="max-w-xl text-3xl font-bold tracking-tight text-balance sm:text-4xl"
            >
              The parts of the quarter that usually live in five different apps
            </h2>

            <div className="mt-14 flex flex-col gap-16 sm:gap-20">
              <FeatureRow
                number="01"
                title="A chat for every class"
                vignette={<SyncVignette />}
              >
                Type a course code and its chat opens; the campus catalog
                autocompletes the rest. Your classmates are already in it,
                because they added the same classes. Drop the class in week 2
                like everyone does, and the channel quietly lets you go.
              </FeatureRow>

              <FeatureRow
                number="02"
                title="Notes that survive the quarter"
                flip
                vignette={<NotesVignette />}
              >
                Week 5 slides shouldn&apos;t be 400 messages deep in somebody
                else&apos;s group chat. On Hearth, notes live with the course:
                uploader credit, one tap to download, still sitting there
                during finals week exactly where they were left.
              </FeatureRow>

              <FeatureRow
                number="03"
                title="Study sessions with a headcount"
                vignette={<EventMiniVignette />}
              >
                Spin up a review session before the midterm, cap it at the six
                seats the room actually has, and know who&apos;s coming before
                you claim a table. Tied to your courses and clubs, visible to
                the right people and nobody else.
              </FeatureRow>

              <FeatureRow
                number="04"
                title="The rest of campus"
                flip
                vignette={<CampusVignette />}
              >
                DMs with read state. Campus channels every Davis student is in
                from day one: General, Study buddies, Asks and offers, where
                last quarter&apos;s textbook finds its next owner. Students
                open new channels from there, and clubs run their own rooms.
              </FeatureRow>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- */}
        {/* Verification: three plain sentences, no theater           */}
        {/* -------------------------------------------------------- */}
        <section
          aria-labelledby="trust-heading"
          className="border-t border-border/60 bg-surface"
        >
          <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="grid gap-10 md:grid-cols-[1fr_1.4fr]">
              <div>
                <h2
                  id="trust-heading"
                  className="text-3xl font-bold tracking-tight text-balance sm:text-4xl"
                >
                  Why it stays Aggies-only
                </h2>
                <p className="mt-4 text-muted text-pretty">
                  A campus app only works if everyone in it is actually on
                  campus. So the door is narrow, and what happens behind it is
                  visible.
                </p>
              </div>
              <ol className="flex flex-col divide-y divide-border">
                <li className="flex gap-4 py-5 first:pt-0 last:pb-0">
                  <span className="text-sm font-bold text-brand">1</span>
                  <p className="text-sm leading-relaxed text-muted">
                    <strong className="font-semibold text-foreground">
                      Your @ucdavis.edu email is the whole sign-up.
                    </strong>{" "}
                    Confirm it from your inbox and you&apos;re in. That one
                    check is what keeps everyone who isn&apos;t at Davis out.
                  </p>
                </li>
                <li className="flex gap-4 py-5 first:pt-0 last:pb-0">
                  <span className="text-sm font-bold text-brand">2</span>
                  <p className="text-sm leading-relaxed text-muted">
                    <strong className="font-semibold text-foreground">
                      Your courses are run by you.
                    </strong>{" "}
                    You add your own classes; nothing connects to Canvas or
                    Schedule Builder, and nothing about your schedule is
                    collected behind your back. Each course chat is visible
                    only to classmates who added the same class.
                  </p>
                </li>
                <li className="flex gap-4 py-5 first:pt-0 last:pb-0">
                  <span className="text-sm font-bold text-brand">3</span>
                  <p className="text-sm leading-relaxed text-muted">
                    <strong className="font-semibold text-foreground">
                      Privacy comes with receipts.
                    </strong>{" "}
                    Everything you post stays inside the verified campus, and
                    where privacy matters most we show you the log: audited
                    events become notifications automatically, so nothing
                    happens silently.
                  </p>
                </li>
              </ol>
            </div>
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
            className="text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Questions, answered
          </h2>
          <div className="mt-8 flex flex-col gap-3">
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
        {/* Closing CTA                                               */}
        {/* -------------------------------------------------------- */}
        <section
          aria-labelledby="cta-heading"
          className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6"
        >
          <div className="rounded-card bg-brand px-6 py-12 shadow-lift sm:px-12 sm:py-16">
            <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <LogoMark className="size-9 text-brand-fg" />
                <h2
                  id="cta-heading"
                  className="mt-4 text-2xl font-bold tracking-tight text-balance text-brand-fg sm:text-3xl"
                >
                  Your classes already have chats. You&apos;re just not in
                  them yet.
                </h2>
                <p className="mt-2 max-w-md text-sm text-brand-fg sm:text-base">
                  It takes your @ucdavis.edu email and about a minute.
                </p>
              </div>
              <Link
                href="/signup"
                className="inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-full bg-surface px-7 py-3.5 text-base font-semibold text-foreground shadow-lift transition-all hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-fg active:scale-[0.98]"
              >
                Join Hearth
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
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
                Made in Davis, between classes.
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
              Never selling your data, never running ads in your course chats.
            </p>
            <p>&copy; {new Date().getFullYear()} Hearth</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feature row: number, title, prose, vignette. Alternates sides.      */
/* ------------------------------------------------------------------ */

function FeatureRow({
  number,
  title,
  flip,
  vignette,
  children,
}: {
  number: string;
  title: string;
  flip?: boolean;
  vignette: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
      <div className={cn("max-w-md", flip && "md:order-2 md:justify-self-end")}>
        <p className="text-sm font-bold text-brand">{number}</p>
        <h3 className="mt-2 text-2xl font-bold tracking-tight text-balance">
          {title}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-muted text-pretty sm:text-base">
          {children}
        </p>
      </div>
      <div
        aria-hidden="true"
        className={cn("select-none", flip && "md:order-1")}
      >
        {vignette}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Vignettes: fake-UI panels built purely from tokens. Everything in   */
/* them is UC Davis: real course codes, real buildings, the quarter    */
/* system. Decorative: hidden from assistive tech.                     */
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

/** Hero panel: a course chat with its composer. */
function ChatVignette() {
  return (
    <VignetteFrame>
      <div className="flex items-center gap-2.5 border-b border-border/70 pb-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <BookOpen className="size-4" />
        </span>
        <span className="text-sm font-bold">MAT 21B</span>
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
              friday, she pushed it in lecture. notes are in the channel
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-surface-2 px-3.5 py-2 shadow-soft">
          <span className="flex-1 text-xs text-muted">Message MAT 21B…</span>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg">
            <Send className="size-3" />
          </span>
        </div>
      </div>
    </VignetteFrame>
  );
}

/** Hero second panel: an event card with RSVPs. */
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
          <p className="truncate text-sm font-bold">PHY 9B midterm review</p>
          <p className="text-[11px] text-muted">Hosted by Study buddies</p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1.5 text-xs text-muted">
        <p className="flex items-center gap-2">
          <MapPin className="size-3.5" /> Shields, 24-hour study room
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

/* --- Compact vignettes for the feature rows. --- */

/** Course list growing as you add classes; catalog fills in the details. */
function SyncVignette() {
  const rows = [
    {
      code: "ECS 36A",
      tag: "Added by you",
      tagClass: "bg-brand-soft text-brand-ink",
    },
    {
      code: "PHY 9B",
      tag: "From the catalog",
      tagClass: "bg-success/10 text-success",
    },
    {
      code: "MAT 21B",
      tag: "You're the first",
      tagClass: "bg-surface-2 text-muted",
    },
  ];
  return (
    <VignetteFrame className="p-3.5 sm:p-4">
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div
            key={row.code}
            className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background px-3 py-2"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
              <BookOpen className="size-3.5 shrink-0 text-brand" />
              <span className="truncate">{row.code}</span>
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
    </VignetteFrame>
  );
}

/** File rows that live with the course. */
function NotesVignette() {
  const files = [
    { name: "Week 5 lecture notes.pdf", meta: "maya · 1.2 MB" },
    { name: "Midterm 2 study guide.pdf", meta: "dev · 840 KB" },
  ];
  return (
    <VignetteFrame className="p-3.5 sm:p-4">
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
    </VignetteFrame>
  );
}

/** A compact study-session card with RSVPs. */
function EventMiniVignette() {
  return (
    <VignetteFrame className="p-3.5 sm:p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 flex-col items-center justify-center rounded-xl bg-accent-soft text-accent">
          <span className="text-[8px] font-bold uppercase leading-none">
            Sun
          </span>
          <span className="text-xs font-bold leading-tight">17</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold">CHE 2B study group</p>
          <p className="text-[10px] text-muted">Sun · 3 PM · the CoHo</p>
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
    </VignetteFrame>
  );
}

/** Campus channel chips plus a fresh DM. */
function CampusVignette() {
  return (
    <VignetteFrame className="p-3.5 sm:p-4">
      <div className="flex flex-wrap gap-1.5">
        {/* The seeded campus rooms wear their purpose glyphs, never the hash. */}
        {[
          { title: "General", icon: Coffee },
          { title: "Study buddies", icon: Users },
          { title: "Asks and offers", icon: Tag },
        ].map((room, i) => (
          <span
            key={room.title}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold",
              i === 1 ? "bg-brand-soft text-brand-ink" : "bg-surface-2 text-muted"
            )}
          >
            <room.icon className="size-3" />
            {room.title}
          </span>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2.5 rounded-xl bg-background px-3 py-2 shadow-soft">
        <FakeAvatar label="MJ" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">
            maya <span className="font-normal text-muted">· now</span>
          </p>
          <p className="truncate text-[11px] text-muted">
            quiet floor of Shields at 7, who&apos;s in?
          </p>
        </div>
        <span className="size-2 shrink-0 rounded-full bg-brand" />
      </div>
    </VignetteFrame>
  );
}
