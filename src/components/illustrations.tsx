import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Huddl illustration library: original SVG scenes in a warm,          */
/* hand-drawn style: tilted shapes, steam curls, crumb dots, stitch    */
/* dashes. Everything is token-driven (fill-brand, fill-accent-soft,   */
/* …) so scenes recolor with the theme and stay on-palette by          */
/* construction. All scenes are decorative: render them aria-hidden    */
/* next to real text.                                                  */
/* ------------------------------------------------------------------ */

type SceneProps = { className?: string };

function Scene({
  className,
  children,
  viewBox = "0 0 200 140",
}: SceneProps & { children: React.ReactNode; viewBox?: string }) {
  return (
    <svg
      viewBox={viewBox}
      aria-hidden
      className={cn("h-32 w-auto select-none", className)}
    >
      {children}
    </svg>
  );
}

/* Hand-drawn accents. Each scene carries one or two, never more. */

type AccentProps = { x: number; y: number; className?: string };

/** Three short S-curves of rising steam, kettle-warm, drawn loose. */
function Steam({ x, y, className }: AccentProps) {
  return (
    <g
      className={cn("stroke-brand-2", className)}
      strokeWidth="2.5"
      strokeLinecap="round"
      fill="none"
      opacity="0.75"
    >
      <path d={`M ${x - 7} ${y + 10} c 3 -3.5 -3 -7 0 -10.5`} />
      <path d={`M ${x + 1} ${y + 13} c 3 -4.5 -3 -9 0 -13.5`} />
      <path d={`M ${x + 9} ${y + 10} c 3 -3.5 -3 -7 0 -10.5`} />
    </g>
  );
}

/** A scatter of three tiny round crumbs. Someone's been snacking here. */
function Crumbs({ x, y, className }: AccentProps) {
  return (
    <g className={cn("fill-brand-2", className)} opacity="0.7">
      <circle cx={x} cy={y} r="2.5" />
      <circle cx={x + 8} cy={y + 6} r="1.8" />
      <circle cx={x + 2} cy={y + 12} r="1.4" />
    </g>
  );
}

/** A short dashed arc: a stitch of thread on fabric. */
function Stitch({ x, y, className }: AccentProps) {
  return (
    <path
      d={`M ${x - 12} ${y + 4} q 12 -10 24 0`}
      className={cn("stroke-brand-soft", className)}
      strokeWidth="3"
      strokeLinecap="round"
      strokeDasharray="5 6"
      fill="none"
    />
  );
}

/** Two speech bubbles leaning into each other: chat, DMs, channels. */
export function ChatScene({ className }: SceneProps) {
  return (
    <Scene className={className}>
      <ellipse cx="100" cy="122" rx="64" ry="8" className="fill-surface-3" opacity="0.6" />
      {/* Back bubble */}
      <g transform="rotate(-4 66 62)">
        <rect x="22" y="30" width="88" height="56" rx="20" className="fill-brand-soft" />
        <path d="M46 84 l-6 16 18 -12 z" className="fill-brand-soft" />
        <circle cx="48" cy="58" r="5" className="fill-brand" />
        <circle cx="66" cy="58" r="5" className="fill-brand" opacity="0.65" />
        <circle cx="84" cy="58" r="5" className="fill-brand" opacity="0.35" />
      </g>
      {/* Front bubble */}
      <g transform="rotate(3 134 74)">
        <rect x="94" y="46" width="84" height="52" rx="18" className="fill-surface stroke-border" strokeWidth="2" />
        <path d="M150 96 l6 14 -18 -10 z" className="fill-surface" />
        <rect x="108" y="62" width="46" height="6" rx="3" className="fill-surface-3" />
        <rect x="108" y="76" width="32" height="6" rx="3" className="fill-brand-2" opacity="0.8" />
      </g>
      <Steam x={176} y={22} />
      <Crumbs x={14} y={20} className="fill-brand" />
    </Scene>
  );
}

/** Calendar with a confirmed day: events, study sessions. */
export function CalendarScene({ className }: SceneProps) {
  return (
    <Scene className={className}>
      <ellipse cx="100" cy="124" rx="58" ry="8" className="fill-surface-3" opacity="0.6" />
      <g transform="rotate(-2 100 74)">
        <rect x="52" y="26" width="96" height="88" rx="16" className="fill-surface stroke-border" strokeWidth="2" />
        <path d="M52 42 a16 16 0 0 1 16 -16 h64 a16 16 0 0 1 16 16 v10 h-96 z" className="fill-brand" />
        <rect x="72" y="16" width="8" height="18" rx="4" className="fill-brand-ink" />
        <rect x="120" y="16" width="8" height="18" rx="4" className="fill-brand-ink" />
        {[68, 92, 116].map((x) =>
          [66, 84].map((y) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="16" height="12" rx="4" className="fill-surface-2" />
          ))
        )}
        <circle cx="124" cy="90" r="13" className="fill-accent" />
        <path d="M118 90 l4.5 4.5 8 -9" className="stroke-on-solid" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>
      <Stitch x={164} y={24} />
      <Crumbs x={30} y={36} className="fill-brand" />
    </Scene>
  );
}

/** Stacked note sheets: files and note sharing. */
export function NotesScene({ className }: SceneProps) {
  return (
    <Scene className={className}>
      <ellipse cx="100" cy="124" rx="56" ry="8" className="fill-surface-3" opacity="0.6" />
      <g transform="rotate(6 116 78)">
        <rect x="76" y="30" width="80" height="92" rx="12" className="fill-brand-soft" />
      </g>
      <g transform="rotate(-3 96 74)">
        <rect x="56" y="24" width="80" height="94" rx="12" className="fill-surface stroke-border" strokeWidth="2" />
        <rect x="68" y="42" width="44" height="7" rx="3.5" className="fill-brand" />
        <rect x="68" y="58" width="56" height="6" rx="3" className="fill-surface-3" />
        <rect x="68" y="72" width="56" height="6" rx="3" className="fill-surface-3" />
        <rect x="68" y="86" width="38" height="6" rx="3" className="fill-surface-3" />
        <circle cx="120" cy="100" r="10" className="fill-brand-2" opacity="0.9" />
        <path d="M116.5 100 l2.6 2.6 4.6 -5.2" className="stroke-on-solid" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>
      <Crumbs x={168} y={32} />
      <Stitch x={36} y={26} className="stroke-accent-soft" />
    </Scene>
  );
}

/** Three figures leaning into a huddle: people, clubs, community. */
export function HuddleScene({ className }: SceneProps) {
  return (
    <Scene className={className}>
      <ellipse cx="100" cy="124" rx="66" ry="8" className="fill-surface-3" opacity="0.6" />
      {/* Left figure */}
      <g transform="rotate(8 58 90)">
        <circle cx="58" cy="58" r="16" className="fill-accent-soft" />
        <circle cx="58" cy="54" r="7" className="fill-accent" />
        <path d="M42 96 a16 18 0 0 1 32 0 v14 h-32 z" className="fill-accent-soft" />
      </g>
      {/* Right figure */}
      <g transform="rotate(-8 142 90)">
        <circle cx="142" cy="58" r="16" className="fill-brand-soft" />
        <circle cx="142" cy="54" r="7" className="fill-brand-2" />
        <path d="M126 96 a16 18 0 0 1 32 0 v14 h-32 z" className="fill-brand-soft" />
      </g>
      {/* Center figure, in front */}
      <circle cx="100" cy="48" r="19" className="fill-brand-soft" />
      <circle cx="100" cy="44" r="8.5" className="fill-brand" />
      <path d="M80 94 a20 22 0 0 1 40 0 v20 h-40 z" className="fill-brand" />
      <Stitch x={176} y={28} />
      <Crumbs x={22} y={32} className="fill-brand" />
    </Scene>
  );
}

/** Shield with a check: privacy, verification, trust. */
export function ShieldScene({ className }: SceneProps) {
  return (
    <Scene className={className}>
      <ellipse cx="100" cy="124" rx="52" ry="8" className="fill-surface-3" opacity="0.6" />
      <path
        d="M100 18 l40 14 v34 c0 26 -18 42 -40 52 c-22 -10 -40 -26 -40 -52 v-34 z"
        className="fill-accent-soft stroke-accent"
        strokeWidth="2.5"
      />
      <path
        d="M100 34 l26 9 v24 c0 18 -12 30 -26 37 c-14 -7 -26 -19 -26 -37 v-24 z"
        className="fill-surface"
      />
      <path
        d="M86 66 l10 10 20 -22"
        className="stroke-accent"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Stitch x={156} y={28} />
      <Crumbs x={40} y={22} className="fill-brand" />
    </Scene>
  );
}

/** Compass and route: discovery, browsing, setup. */
export function DiscoverScene({ className }: SceneProps) {
  return (
    <Scene className={className}>
      <ellipse cx="100" cy="124" rx="56" ry="8" className="fill-surface-3" opacity="0.6" />
      <path
        d="M30 96 C 56 60, 90 116, 122 74 S 176 52, 182 44"
        className="stroke-brand-soft"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="1 12"
        fill="none"
      />
      <circle cx="100" cy="70" r="34" className="fill-surface stroke-border" strokeWidth="2" />
      <circle cx="100" cy="70" r="26" className="fill-brand-soft" />
      <path d="M112 54 l-8 22 -14 6 8 -22 z" className="fill-brand" />
      <circle cx="100" cy="70" r="4" className="fill-surface" />
      <circle cx="182" cy="44" r="7" className="fill-brand-2" />
      <Crumbs x={32} y={28} />
    </Scene>
  );
}
