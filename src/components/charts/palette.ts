/**
 * Chart colour tokens.
 *
 * Derived from the project's data-visualization standard and verified with the
 * palette validator against this application's chart surface (#ffffff, the card
 * background). Recorded results, light mode:
 *
 *   CATEGORICAL (3 slots, --pairs all)
 *     lightness band PASS · chroma floor PASS
 *     CVD separation PASS  (worst all-pairs ΔE 9.2 deutan, 9.6 tritan)
 *     normal-vision   PASS  (worst all-pairs ΔE 24.0)
 *     contrast        WARN  (#1baf7a at 2.82:1) → relief applied: every chart
 *                           ships visible labels and a data-table view.
 *
 *   ORDINAL_5 and ORDINAL_4 (--ordinal)
 *     monotone lightness PASS · adjacent ΔL PASS (all gaps ≥ 0.06)
 *     light-end contrast PASS (2.11:1) · single hue PASS
 *
 * Status colours are fixed by the standard and are deliberately NOT themed or
 * re-stepped. They fail a categorical CVD check against each other by design;
 * the required mitigation is that a status colour never carries meaning alone —
 * it always ships with an icon or a written label. That is enforced by the
 * components in this directory.
 *
 * Ink and chrome tokens are substituted for this product's cool-grey scale so
 * chart text matches the surrounding interface. Only the ink was substituted;
 * the validated series colours are unchanged.
 *
 * Deliberate limitation: this application is light-mode only, so no dark-mode
 * steps are defined. See docs/DECISIONS.md.
 */

/** Categorical identity. Assigned in fixed order, never cycled. Capped at 3. */
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a'] as const;

/** Ordered discrete stages, light to dark. */
export const ORDINAL_5 = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'] as const;
export const ORDINAL_4 = ['#86b6ef', '#3987e5', '#256abf', '#0d366b'] as const;
export const ORDINAL_3 = ['#86b6ef', '#2a78d6', '#0d366b'] as const;

/** Continuous magnitude (heat maps). Lightest step may recede to the surface. */
export const SEQUENTIAL = [
  '#cde2fb',
  '#b7d3f6',
  '#9ec5f4',
  '#86b6ef',
  '#6da7ec',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#1c5cab',
  '#184f95',
  '#104281',
  '#0d366b',
] as const;

/** Reserved state colours. Always paired with an icon or written label. */
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

/** Ink inside a filled mark, chosen by the fill's luminance. */
export const ON_FILL = { light: '#ffffff', dark: '#0b0b0b' } as const;

/** Fills that need near-black rather than white text. */
const LIGHT_FILLS = new Set<string>([
  '#86b6ef',
  '#9ec5f4',
  '#b7d3f6',
  '#cde2fb',
  '#eda100',
  STATUS.warning,
  '#c3c2b7',
  '#e2e8f0',
]);

export function inkOn(fill: string): string {
  return LIGHT_FILLS.has(fill.toLowerCase()) ? ON_FILL.dark : ON_FILL.light;
}

/** Chrome and ink, substituted for this product's grey scale. */
export const CHROME = {
  surface: '#ffffff',
  primaryInk: '#0f172a',
  secondaryInk: '#475569',
  mutedInk: '#64748b',
  gridline: '#e2e8f0',
  baseline: '#cbd5e1',
  /** "None", "not started", "no data" — never a value colour. */
  absent: '#c3c2b7',
} as const;

/** The surface gap that separates touching marks. */
export const SURFACE_GAP = 2;

/**
 * Review lifecycle stages, in order. "Not started" takes the neutral absent
 * colour because it means nothing has happened yet, and the four real stages
 * then read light to dark as work progresses.
 */
export const STAGE_COLORS: Record<string, string> = {
  NOT_STARTED: CHROME.absent,
  IN_PROGRESS: ORDINAL_4[0],
  DRAFT: ORDINAL_4[0],
  SUBMITTED: ORDINAL_4[1],
  AWAITING_APPROVAL: ORDINAL_4[1],
  APPROVED: ORDINAL_4[2],
  RELEASED: ORDINAL_4[2],
  ACKNOWLEDGED: ORDINAL_4[3],
  CLOSED: ORDINAL_4[3],
};

/** Maps a goal or review health label onto a status colour. */
export function healthColor(health: string): string {
  switch (health) {
    case 'ON_TRACK':
      return STATUS.good;
    case 'AT_RISK':
      return STATUS.warning;
    case 'OFF_TRACK':
      return STATUS.serious;
    case 'BLOCKED':
      return STATUS.critical;
    default:
      return CHROME.absent;
  }
}

/** Picks a sequential step for a 0..1 magnitude. */
export function sequentialStep(fraction: number): string {
  if (!Number.isFinite(fraction)) return CHROME.absent;
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const index = Math.round(clamped * (SEQUENTIAL.length - 1));
  return SEQUENTIAL[index] as string;
}

/** Compact value formatting for axis ticks and labels. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${Math.round(value / 1000)}K`;
  return value.toLocaleString('en-US');
}

/** Axis ticks rounded to clean numbers. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const rawStep = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
  const step = candidates.find((c) => c >= rawStep) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}
