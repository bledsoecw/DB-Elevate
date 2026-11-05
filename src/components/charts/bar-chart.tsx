'use client';

import { useId, useState } from 'react';
import { CHROME, ORDINAL_5, SURFACE_GAP, inkOn } from './palette';
import { ChartFrame, ChartTooltip, NoChartData, type LegendEntry } from './chart-frame';

export interface BarDatum {
  label: string;
  value: number;
  /** Overrides the series colour for this bar, e.g. a status colour. */
  color?: string;
  /** Shown in the tooltip under the value. */
  note?: string;
  /** Replaces the printed value, e.g. "4.1 of 5". */
  displayValue?: string;
}

/**
 * Horizontal bar chart: magnitude compared across named things.
 *
 * Horizontal rather than vertical because the categories here are usually
 * phrases (engagement factors, competency names, department names) and
 * horizontal bars give labels room to be read without rotation.
 *
 * Bars are capped at 20px with a 4px rounded data-end, square at the baseline,
 * and every bar is directly labelled — which is also the relief that lets a
 * lower-contrast series colour be used at all.
 */
export function BarChart({
  title,
  subtitle,
  data,
  max,
  footnote,
  color,
  valueSuffix = '',
  valueFormatter,
  legend,
  barHeight = 20,
  labelWidth = 190,
}: {
  title: string;
  subtitle?: string;
  data: BarDatum[];
  /** Axis maximum. Defaults to the largest value. */
  max?: number;
  footnote?: React.ReactNode;
  color?: string;
  valueSuffix?: string;
  valueFormatter?: (value: number) => string;
  legend?: LegendEntry[];
  barHeight?: number;
  labelWidth?: number;
}) {
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const clipId = useId();

  if (data.length === 0) {
    return (
      <ChartFrame title={title} subtitle={subtitle} footnote={footnote}>
        <NoChartData />
      </ChartFrame>
    );
  }

  const seriesColor = color ?? ORDINAL_5[2];
  const axisMax = Math.max(max ?? Math.max(...data.map((d) => d.value)), 0.0001);
  const rowHeight = barHeight + 16;
  const fmt = valueFormatter ?? ((v: number) => `${Math.round(v * 10) / 10}${valueSuffix}`);

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      footnote={footnote}
      legend={legend}
      table={{
        columns: ['', 'Value'],
        rows: data.map((d) => [d.label, d.displayValue ?? fmt(d.value)]),
      }}
    >
      <div className="relative">
        <ul className="space-y-0">
          {data.map((d, i) => {
            const fill = d.color ?? seriesColor;
            const pct = Math.min(100, Math.max(0, (d.value / axisMax) * 100));
            return (
              <li
                key={`${d.label}-${i}`}
                className="flex items-center gap-3 py-2"
                style={{ minHeight: rowHeight }}
                onMouseEnter={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const parent = (e.currentTarget.parentElement?.parentElement as HTMLElement)?.getBoundingClientRect();
                  if (parent) {
                    setHover({
                      index: i,
                      x: rect.left - parent.left + Math.min(rect.width * (pct / 100), rect.width) * 0.5 + labelWidth / 2,
                      y: rect.top - parent.top,
                    });
                  }
                }}
                onMouseLeave={() => setHover(null)}
              >
                <span
                  className="flex-shrink-0 text-right text-xs leading-snug text-slate-600"
                  style={{ width: labelWidth }}
                >
                  {d.label}
                </span>
                <span className="relative min-w-0 flex-1">
                  {/* Baseline the bars grow from. */}
                  <svg
                    width="100%"
                    height={barHeight}
                    role="img"
                    aria-label={`${d.label}: ${d.displayValue ?? fmt(d.value)}`}
                    className="block overflow-visible"
                  >
                    <clipPath id={`${clipId}-${i}`}>
                      {/* Rounded data-end, square at the baseline: draw a rounded
                          rect and clip its left edge back to square. */}
                      <rect x="0" y="0" width="100%" height={barHeight} rx="4" />
                    </clipPath>
                    <rect
                      x="0"
                      y="0"
                      width={`${pct}%`}
                      height={barHeight}
                      rx="4"
                      fill={fill}
                    />
                    <rect x="0" y="0" width="4" height={barHeight} fill={fill} />
                  </svg>
                </span>
                <span className="w-16 flex-shrink-0 text-right text-xs font-semibold tabular-nums text-slate-800">
                  {d.displayValue ?? fmt(d.value)}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Axis baseline reference line. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0"
          style={{ left: labelWidth + 12, borderLeft: `1px solid ${CHROME.baseline}` }}
        />

        {hover !== null && data[hover.index] && (
          <ChartTooltip x={hover.x} y={hover.y}>
            <p className="font-semibold text-slate-900">{data[hover.index]!.label}</p>
            <p className="mt-0.5 tabular-nums text-slate-700">
              {data[hover.index]!.displayValue ?? fmt(data[hover.index]!.value)}
            </p>
            {data[hover.index]!.note && (
              <p className="mt-1 leading-snug text-slate-500">{data[hover.index]!.note}</p>
            )}
          </ChartTooltip>
        )}
      </div>
    </ChartFrame>
  );
}

/**
 * One whole split into parts — the tall segmented bar.
 *
 * No baseline, so no end is square. Each part gets its own block with 4px
 * corners, separated by a 2px surface gap, and prints its share inside at the
 * leading edge when the block is wide enough to hold the text.
 */
export function SegmentedBar({
  title,
  subtitle,
  parts,
  footnote,
  totalLabel,
  height = 28,
}: {
  title: string;
  subtitle?: string;
  parts: { label: string; value: number; color: string }[];
  footnote?: React.ReactNode;
  totalLabel?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const present = parts.filter((p) => p.value > 0);

  if (total === 0) {
    return (
      <ChartFrame title={title} subtitle={subtitle} footnote={footnote}>
        <NoChartData message="Nothing recorded yet." />
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      footnote={footnote}
      legend={parts.map((p) => ({ label: p.label, color: p.color }))}
      table={{
        columns: ['', 'Count', 'Share'],
        rows: parts.map((p) => [
          p.label,
          p.value,
          total > 0 ? `${Math.round((p.value / total) * 100)}%` : '—',
        ]),
      }}
    >
      <div className="relative">
        <div
          className="flex w-full"
          style={{ height, gap: SURFACE_GAP }}
          role="img"
          aria-label={`${title}. ${parts
            .map((p) => `${p.label}: ${p.value} of ${total}, ${Math.round((p.value / total) * 100)}%`)
            .join('. ')}`}
        >
          {present.map((p, i) => {
            const share = (p.value / total) * 100;
            // Only print the share when the block is wide enough to hold it.
            const wideEnough = share >= 9;
            return (
              <div
                key={`${p.label}-${i}`}
                className="flex items-center overflow-hidden rounded"
                style={{ width: `${share}%`, backgroundColor: p.color, minWidth: 4 }}
                onMouseEnter={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const parent = (e.currentTarget.parentElement?.parentElement as HTMLElement)?.getBoundingClientRect();
                  if (parent) {
                    setHover({
                      index: present.indexOf(p),
                      x: rect.left - parent.left + rect.width / 2,
                      y: rect.top - parent.top,
                    });
                  }
                }}
                onMouseLeave={() => setHover(null)}
                tabIndex={0}
                aria-label={`${p.label}: ${p.value}, ${Math.round(share)}%`}
              >
                {wideEnough && (
                  <span
                    className="whitespace-nowrap pl-2 text-xs font-semibold tabular-nums"
                    style={{ color: inkOn(p.color) }}
                  >
                    {Math.round(share)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {totalLabel && (
          <p className="mt-2 text-xs text-slate-500">{totalLabel}</p>
        )}
        {hover !== null && present[hover.index] && (
          <ChartTooltip x={hover.x} y={hover.y}>
            <p className="font-semibold text-slate-900">{present[hover.index]!.label}</p>
            <p className="mt-0.5 tabular-nums text-slate-700">
              {present[hover.index]!.value} of {total} ·{' '}
              {Math.round((present[hover.index]!.value / total) * 100)}%
            </p>
          </ChartTooltip>
        )}
      </div>
    </ChartFrame>
  );
}
