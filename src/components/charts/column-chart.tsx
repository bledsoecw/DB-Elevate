'use client';

import { useState } from 'react';
import { CHROME, ORDINAL_5, niceTicks } from './palette';
import { ChartFrame, ChartTooltip, NoChartData, type LegendEntry } from './chart-frame';

export interface ColumnDatum {
  label: string;
  value: number;
  color?: string;
  note?: string;
  displayValue?: string;
}

/**
 * Vertical column chart: a distribution across an ordered scale, or counts by
 * period. One axis only — two measures of different scale get two charts.
 *
 * Columns are capped at 48px, carry a 4px rounded cap and sit square on the
 * baseline, with the value printed on the cap.
 */
export function ColumnChart({
  title,
  subtitle,
  data,
  footnote,
  color,
  height = 180,
  legend,
  yLabel,
  valueFormatter,
  highlightIndex,
}: {
  title: string;
  subtitle?: string;
  data: ColumnDatum[];
  footnote?: React.ReactNode;
  color?: string;
  height?: number;
  legend?: LegendEntry[];
  yLabel?: string;
  valueFormatter?: (value: number) => string;
  /** Emphasises one column, e.g. the current period. */
  highlightIndex?: number;
}) {
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);

  if (data.length === 0) {
    return (
      <ChartFrame title={title} subtitle={subtitle} footnote={footnote}>
        <NoChartData />
      </ChartFrame>
    );
  }

  const seriesColor = color ?? ORDINAL_5[2];
  const rawMax = Math.max(...data.map((d) => d.value), 0);
  const ticks = niceTicks(rawMax || 1, 4);
  const axisMax = Math.max(ticks[ticks.length - 1] ?? 1, 0.0001);
  const fmt = valueFormatter ?? ((v: number) => String(Math.round(v * 10) / 10));

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      footnote={footnote}
      legend={legend}
      table={{
        columns: ['', yLabel ?? 'Value'],
        rows: data.map((d) => [d.label, d.displayValue ?? fmt(d.value)]),
      }}
    >
      <div className="relative">
        <div className="flex gap-2">
          {/* Y axis ticks */}
          <div
            className="relative flex-shrink-0 text-right"
            style={{ width: 34, height }}
            aria-hidden
          >
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums"
                style={{ bottom: `${(t / axisMax) * 100}%`, color: CHROME.mutedInk }}
              >
                {fmt(t)}
              </span>
            ))}
          </div>

          <div className="relative min-w-0 flex-1">
            {/* Gridlines: hairline, solid, recessive. */}
            <div className="absolute inset-0" style={{ height }} aria-hidden>
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute inset-x-0"
                  style={{
                    bottom: `${(t / axisMax) * 100}%`,
                    borderTop: `1px solid ${t === 0 ? CHROME.baseline : CHROME.gridline}`,
                  }}
                />
              ))}
            </div>

            <div
              className="relative flex items-end justify-around gap-1"
              style={{ height }}
              role="img"
              aria-label={`${title}. ${data.map((d) => `${d.label}: ${d.displayValue ?? fmt(d.value)}`).join('. ')}`}
            >
              {data.map((d, i) => {
                const pct = axisMax > 0 ? (d.value / axisMax) * 100 : 0;
                const fill = d.color ?? seriesColor;
                const dim = highlightIndex !== undefined && highlightIndex !== i;
                return (
                  <div
                    key={`${d.label}-${i}`}
                    className="flex h-full min-w-0 flex-1 items-end justify-center"
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const parent = (
                        e.currentTarget.parentElement?.parentElement?.parentElement as HTMLElement
                      )?.getBoundingClientRect();
                      if (parent) {
                        setHover({
                          index: i,
                          x: rect.left - parent.left + rect.width / 2,
                          y: rect.top - parent.top + rect.height * (1 - pct / 100),
                        });
                      }
                    }}
                    onMouseLeave={() => setHover(null)}
                  >
                    <div className="relative flex w-full max-w-[48px] justify-center">
                      {d.value > 0 && (
                        <span
                          className="absolute -top-5 w-full text-center text-[11px] font-semibold tabular-nums text-slate-700"
                          style={{ bottom: `${pct}%`, top: 'auto', marginBottom: 2 }}
                        >
                          {d.displayValue ?? fmt(d.value)}
                        </span>
                      )}
                      <div
                        className="w-full rounded-t"
                        style={{
                          height: `${Math.max(pct, d.value > 0 ? 1.5 : 0)}%`,
                          backgroundColor: fill,
                          opacity: dim ? 0.45 : 1,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-1.5 flex justify-around gap-1">
              {data.map((d, i) => (
                <span
                  key={`${d.label}-label-${i}`}
                  className="min-w-0 flex-1 text-center text-[10px] leading-tight"
                  style={{ color: CHROME.mutedInk }}
                >
                  {d.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {hover !== null && data[hover.index] && (
          <ChartTooltip x={hover.x + 36} y={hover.y}>
            <p className="font-semibold text-slate-900">{data[hover.index]!.label}</p>
            <p className="mt-0.5 tabular-nums text-slate-700">
              {data[hover.index]!.displayValue ?? fmt(data[hover.index]!.value)}
              {yLabel ? ` ${yLabel.toLowerCase()}` : ''}
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
 * Stacked columns for lifecycle progress: one column per group, each split into
 * ordered stages. A 2px surface gap separates every segment.
 */
export function StackedColumnChart({
  title,
  subtitle,
  groups,
  stages,
  footnote,
  height = 180,
}: {
  title: string;
  subtitle?: string;
  groups: { label: string; values: Record<string, number> }[];
  stages: { key: string; label: string; color: string }[];
  footnote?: React.ReactNode;
  height?: number;
}) {
  const [hover, setHover] = useState<{ group: number; stage: string; x: number; y: number } | null>(
    null,
  );

  const totals = groups.map((g) => stages.reduce((sum, s) => sum + (g.values[s.key] ?? 0), 0));
  const axisMax = Math.max(...totals, 1);

  if (groups.length === 0) {
    return (
      <ChartFrame title={title} subtitle={subtitle} footnote={footnote}>
        <NoChartData />
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      footnote={footnote}
      legend={stages.map((s) => ({ label: s.label, color: s.color }))}
      table={{
        columns: ['', ...stages.map((s) => s.label), 'Total'],
        rows: groups.map((g, i) => [
          g.label,
          ...stages.map((s) => g.values[s.key] ?? 0),
          totals[i] ?? 0,
        ]),
      }}
    >
      <div className="relative">
        <div className="flex items-end justify-around gap-2" style={{ height }}>
          {groups.map((g, gi) => {
            const total = totals[gi] ?? 0;
            return (
              <div key={g.label} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <div
                  className="flex w-full flex-col-reverse justify-start"
                  style={{ height: `${(total / axisMax) * 100}%`, gap: 2 }}
                  role="img"
                  aria-label={`${g.label}: ${stages
                    .filter((s) => (g.values[s.key] ?? 0) > 0)
                    .map((s) => `${s.label} ${g.values[s.key]}`)
                    .join(', ')}`}
                >
                  {stages.map((s) => {
                    const v = g.values[s.key] ?? 0;
                    if (v === 0) return null;
                    return (
                      <div
                        key={s.key}
                        className="w-full rounded-sm"
                        style={{ height: `${(v / total) * 100}%`, backgroundColor: s.color, minHeight: 3 }}
                        onMouseEnter={(e) => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const parent = (
                            e.currentTarget.closest('.relative') as HTMLElement
                          )?.getBoundingClientRect();
                          if (parent) {
                            setHover({
                              group: gi,
                              stage: s.key,
                              x: rect.left - parent.left + rect.width / 2,
                              y: rect.top - parent.top,
                            });
                          }
                        }}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                </div>
                <span className="mt-1.5 block truncate text-center text-[10px]" style={{ color: CHROME.mutedInk }}>
                  {g.label}
                </span>
              </div>
            );
          })}
        </div>

        {hover && (
          <ChartTooltip x={hover.x} y={hover.y}>
            <p className="font-semibold text-slate-900">{groups[hover.group]?.label}</p>
            <p className="mt-0.5 text-slate-700">
              {stages.find((s) => s.key === hover.stage)?.label}:{' '}
              <span className="tabular-nums font-semibold">
                {groups[hover.group]?.values[hover.stage] ?? 0}
              </span>{' '}
              of {totals[hover.group] ?? 0}
            </p>
          </ChartTooltip>
        )}
      </div>
    </ChartFrame>
  );
}
