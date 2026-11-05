/**
 * Empty-state illustrations.
 *
 * Inline SVG rather than image files, for three reasons: they inherit the
 * brand palette through `currentColor` and the brand CSS variables, so a
 * re-brand carries them without anyone re-exporting artwork; they add no
 * network request; and they stay crisp at any size.
 *
 * Each one is decorative. The real message is always the heading and
 * description beside it, so every illustration is `aria-hidden` and nothing
 * here carries meaning a screen reader would miss.
 *
 * Construction over office clip-art where it fits — a crew reading this should
 * recognise their own trade.
 */

type Props = { className?: string };

const BASE = 'h-28 w-auto';

/** Shared palette. Brand tokens so the art follows the configured colours. */
const stroke = 'rgb(var(--brand-600))';
const strokeSoft = 'rgb(var(--brand-300))';
const fillSoft = 'rgb(var(--brand-50))';
const accent = 'rgb(var(--accent-600))';

/** A clipboard with nothing on it — reviews, forms, assignments. */
export function NoFormsArt({ className }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={className ?? BASE} aria-hidden role="presentation">
      <rect x="38" y="20" width="84" height="92" rx="6" fill={fillSoft} stroke={strokeSoft} strokeWidth="2" />
      <rect x="62" y="12" width="36" height="16" rx="5" fill="white" stroke={stroke} strokeWidth="2" />
      <line x1="54" y1="50" x2="106" y2="50" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
      <line x1="54" y1="64" x2="96" y2="64" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
      <line x1="54" y1="78" x2="102" y2="78" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
      <circle cx="118" cy="92" r="16" fill="white" stroke={accent} strokeWidth="2.5" />
      <path d="M111 92l5 5 10-11" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Two speech bubbles — feedback and recognition. */
export function NoFeedbackArt({ className }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={className ?? BASE} aria-hidden role="presentation">
      <path
        d="M22 28h74a6 6 0 016 6v38a6 6 0 01-6 6H52l-16 14V78h-14a6 6 0 01-6-6V34a6 6 0 016-6z"
        fill={fillSoft}
        stroke={strokeSoft}
        strokeWidth="2"
      />
      <line x1="34" y1="44" x2="84" y2="44" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
      <line x1="34" y1="58" x2="70" y2="58" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
      <path
        d="M78 56h56a6 6 0 016 6v30a6 6 0 01-6 6h-8v12l-13-12H78a6 6 0 01-6-6V62a6 6 0 016-6z"
        fill="white"
        stroke={stroke}
        strokeWidth="2"
      />
      <line x1="88" y1="72" x2="124" y2="72" stroke={accent} strokeWidth="3" strokeLinecap="round" />
      <line x1="88" y1="84" x2="112" y2="84" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** A target — goals. */
export function NoGoalsArt({ className }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={className ?? BASE} aria-hidden role="presentation">
      <circle cx="72" cy="64" r="42" fill={fillSoft} stroke={strokeSoft} strokeWidth="2" />
      <circle cx="72" cy="64" r="27" fill="white" stroke={strokeSoft} strokeWidth="2" />
      <circle cx="72" cy="64" r="12" fill="white" stroke={stroke} strokeWidth="2" />
      <circle cx="72" cy="64" r="4" fill={accent} />
      <path d="M72 64L132 18" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
      <path d="M118 16l16 2-2 16" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Two chairs across a table — one-to-ones. */
export function NoMeetingsArt({ className }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={className ?? BASE} aria-hidden role="presentation">
      <ellipse cx="80" cy="70" rx="46" ry="14" fill={fillSoft} stroke={strokeSoft} strokeWidth="2" />
      <line x1="80" y1="70" x2="80" y2="100" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
      <line x1="62" y1="104" x2="98" y2="104" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
      <circle cx="36" cy="40" r="12" fill="white" stroke={stroke} strokeWidth="2" />
      <path d="M18 66c0-10 8-16 18-16s18 6 18 16" fill="white" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      <circle cx="124" cy="40" r="12" fill="white" stroke={accent} strokeWidth="2" />
      <path d="M106 66c0-10 8-16 18-16s18 6 18 16" fill="white" stroke={accent} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Bars rising — surveys and reporting. */
export function NoResultsArt({ className }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={className ?? BASE} aria-hidden role="presentation">
      <line x1="30" y1="100" x2="134" y2="100" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
      <line x1="30" y1="22" x2="30" y2="100" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
      <rect x="44" y="72" width="20" height="28" rx="3" fill={fillSoft} stroke={strokeSoft} strokeWidth="2" />
      <rect x="72" y="54" width="20" height="46" rx="3" fill="white" stroke={stroke} strokeWidth="2" />
      <rect x="100" y="36" width="20" height="64" rx="3" fill="white" stroke={accent} strokeWidth="2" />
      <circle cx="110" cy="24" r="5" fill={accent} />
    </svg>
  );
}

/** A hard hat — people and crews. */
export function NoPeopleArt({ className }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={className ?? BASE} aria-hidden role="presentation">
      <path
        d="M34 82c0-26 20-46 46-46s46 20 46 46"
        fill={fillSoft}
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path d="M70 38c0-8 4-14 10-14s10 6 10 14" fill="white" stroke={stroke} strokeWidth="2.5" />
      <rect x="22" y="80" width="116" height="12" rx="6" fill="white" stroke={stroke} strokeWidth="2.5" />
      <line x1="80" y1="38" x2="80" y2="80" stroke={strokeSoft} strokeWidth="2.5" />
      <line x1="58" y1="46" x2="58" y2="80" stroke={strokeSoft} strokeWidth="2" />
      <line x1="102" y1="46" x2="102" y2="80" stroke={strokeSoft} strokeWidth="2" />
      <circle cx="128" cy="34" r="9" fill="white" stroke={accent} strokeWidth="2.5" />
      <path d="M124 34l3 3 6-7" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A ladder — development and growth. */
export function NoPlansArt({ className }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={className ?? BASE} aria-hidden role="presentation">
      <line x1="56" y1="108" x2="68" y2="16" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
      <line x1="104" y1="108" x2="92" y2="16" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
      <line x1="60" y1="88" x2="100" y2="88" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
      <line x1="62" y1="68" x2="98" y2="68" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
      <line x1="64" y1="48" x2="96" y2="48" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
      <line x1="66" y1="28" x2="94" y2="28" stroke={accent} strokeWidth="3" strokeLinecap="round" />
      <circle cx="124" cy="30" r="10" fill="white" stroke={accent} strokeWidth="2.5" />
      <path d="M124 25v10M119 30h10" stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Nothing found by a filter or search. */
export function NoMatchesArt({ className }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={className ?? BASE} aria-hidden role="presentation">
      <circle cx="70" cy="54" r="30" fill={fillSoft} stroke={stroke} strokeWidth="2.5" />
      <circle cx="70" cy="54" r="20" fill="white" stroke={strokeSoft} strokeWidth="2" />
      <line x1="92" y1="76" x2="116" y2="100" stroke={stroke} strokeWidth="5" strokeLinecap="round" />
      <line x1="60" y1="44" x2="80" y2="64" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
      <line x1="80" y1="44" x2="60" y2="64" stroke={strokeSoft} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Everything cleared — an inbox with nothing waiting. */
export function AllClearArt({ className }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={className ?? BASE} aria-hidden role="presentation">
      <path
        d="M30 58l14-32h72l14 32v34a6 6 0 01-6 6H36a6 6 0 01-6-6V58z"
        fill={fillSoft}
        stroke={strokeSoft}
        strokeWidth="2"
      />
      <path d="M30 58h30l6 12h28l6-12h30" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="80" cy="44" r="15" fill="white" stroke={accent} strokeWidth="2.5" />
      <path d="M73 44l5 5 10-11" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Locked or withheld content. */
export function WithheldArt({ className }: Props) {
  return (
    <svg viewBox="0 0 160 120" className={className ?? BASE} aria-hidden role="presentation">
      <rect x="48" y="56" width="64" height="48" rx="8" fill={fillSoft} stroke={stroke} strokeWidth="2.5" />
      <path d="M62 56V42a18 18 0 0136 0v14" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="80" cy="76" r="6" fill="white" stroke={stroke} strokeWidth="2.5" />
      <line x1="80" y1="82" x2="80" y2="90" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export const ILLUSTRATIONS = {
  forms: NoFormsArt,
  feedback: NoFeedbackArt,
  goals: NoGoalsArt,
  meetings: NoMeetingsArt,
  results: NoResultsArt,
  people: NoPeopleArt,
  plans: NoPlansArt,
  matches: NoMatchesArt,
  clear: AllClearArt,
  withheld: WithheldArt,
} as const;

export type IllustrationName = keyof typeof ILLUSTRATIONS;
