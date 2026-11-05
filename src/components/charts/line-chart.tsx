'use client';

import { useRef, useState } from 'react';
import { CATEGORICAL, CHROME, niceTicks } from './palette';
import { ChartFrame, ChartTooltip, NoChartData } from './chart-frame';

export interface LineSeries {
  label: string;
  points: { x: string; y: number | null }[];
  color?: string;
}

/**
 * Line chart for change over comparable periods.
 *
 * Deliberate restrictions, because the most common way a trend chart misleads
 * is by comparing things that are not comparable:
 *
 *  - One y-axis. Never two scales on one plot.
 *  - A null point breaks the line rather than being interpolated, so a period
 *    with no data does not look like a value.
 *  - The caller is expected to pass a `footnote` saying what the periods are
 *    and whether the underlying measure changed between them.
 */
export function LineChart({
  title,
  subtitle,
  series,
  footnote,
  height = 200,
  yMin = 0,
  yMax,
  valueFormatter,
  yLabel,
}: {
  title: string;
  subtitle?: string;
  series: LineSeries[];
  footnote?: React.ReactNode;
  height?: number;
  yMin?: number;
  yMax?: number;
  valueFormatter?: (value: number) => string;
  yLabel?: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const xLabels = series[0]?.points.map((p) => p.x) ?? [];
  const allValues = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v !== null);

  if (series.length === 0 || xLabels.length === 0 || allValues.length === 0) {
    return (
      <ChartFrame title={title} subtitle={subtitle} footnote={footnote}>
        <NoChartData message="Not enough comparable periods to draw a trend yet." />
      </ChartFrame>
    );
  }

  const dataMax = Math.max(...allValues);
  const ticks = yMax !== undefined ? niceTicks(yMax, 4) : niceTicks(dataMax, 4);
  const top = yMax ?? Math.max(ticks[ticks.length - 1] ?? dataMax, dataMax);
  const span = Math.max(top - yMin, 0.0001);
  const fmt = valueFormatter ?? ((v: number) => String(Math.round(v * 10) / 10));

  const padL = 38;
  const padR = 12;
  const padT = 10;
  const padB = 26;
  const vbW = 600;
  const vbH = height;
  const plotW = vbW - padL - padR;
  const plotH = vbH - padT - padB;

  const xAt = (i: number) =>
    xLabels.length === 1 ? padL + plotW / 2 : padL + (i / (xLabels.length - 1)) * plotW;
  const yAt = (v: number) => padT + plotH - ((v - yMin) / span) * plotH;

  /** Splits a series into unbroken runs so nulls leave gaps. */
  function runs(points: { x: string; y: number | null }[]): { i: number; y: number }[][] {
    const out: { i: number; y: number }[][] = [];
    let current: { i: number; y: number }[] = [];
    points.forEach((p, i) => {
      if (p.y === null || !Number.isFinite(p.y)) {
        if (current.length) out.push(current);
        current = [];
      } else {
        current.push({ i, y: p.y });
      }
    });
    if (current.length) out.push(current);
    return out;
  }

  const singleSeries = series.length === 1;

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      footnote={footnote}
      legend={
        singleSeries
          ? undefined
          : series.map((s, i) => ({
              label: s.label,
              color: s.color ?? CATEGORICAL[i % CATEGORICAL.length] ?? CATEGORICAL[0],
            }))
      }
      table={{
        columns: ['Period', ...series.map((s) => s.label)],
        rows: xLabels.map((x, i) => [
          x,
          ...series.map((s) => {
            const y = s.points[i]?.y;
            return y === null || y === undefined ? 'No data' : fmt(y);
          }),
        ]),
      }}
    >
      <div className="relative" ref={wrapRef}>
        <svg
          viewBox={`0 0 ${vbW} ${vbH}`}
          className="block w-full"
          style={{ height }}
          role="img"
          aria-label={`${title}. ${series
            .map(
              (s) =>
                `${s.label}: ${s.points.map((p) => `${p.x} ${p.y === null ? 'no data' : fmt(p.y)}`).join(', ')}`,
            )
            .join('. ')}`}
          preserveAspectRatio="none"
          onMouseMove={(e) => {
            const svg = e.currentTarget;
            const rect = svg.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            const vbX = ratio * vbW;
            const step = xLabels.length === 1 ? plotW : plotW / (xLabels.length - 1);
            const idx = Math.round((vbX - padL) / step);
            const clamped = Math.min(Math.max(idx, 0), xLabels.length - 1);
            setHoverIndex(clamped);
            setCursor({
              x: (xAt(clamped) / vbW) * rect.width,
              y: 0,
            });
          }}
          onMouseLeave={() => {
            setHoverIndex(null);
            setCursor(null);
          }}
        >
          {/* Gridlines */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={padL}
                x2={vbW - padR}
                y1={yAt(t)}
                y2={yAt(t)}
                stroke={t === yMin ? CHROME.baseline : CHROME.gridline}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={padL - 6}
                y={yAt(t) + 3}
                textAnchor="end"
                fontSize={10}
                fill={CHROME.mutedInk}
              >
                {fmt(t)}
              </text>
            </g>
          ))}

          {/* Crosshair */}
          {hoverIndex !== null && (
            <line
              x1={xAt(hoverIndex)}
              x2={xAt(hoverIndex)}
              y1={padT}
              y2={padT + plotH}
              stroke={CHROME.baseline}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Series */}
          {series.map((s, si) => {
            const stroke = s.color ?? CATEGORICAL[si % CATEGORICAL.length] ?? CATEGORICAL[0];
            return (
              <g key={s.label}>
                {runs(s.points).map((run, ri) => (
                  <polyline
                    key={ri}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    points={run.map((p) => `${xAt(p.i)},${yAt(p.y)}`).join(' ')}
                  />
                ))}
                {s.points.map((p, i) =>
                  p.y === null ? null : (
                    <circle
                      key={i}
                      cx={xAt(i)}
                      cy={yAt(p.y)}
                      r={hoverIndex === i ? 5 : 4}
                      fill={stroke}
                      stroke={CHROME.surface}
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  ),
                )}
              </g>
            );
          })}

          {/* X labels */}
          {xLabels.map((x, i) => (
            <text
              key={`${x}-${i}`}
              x={xAt(i)}
              y={vbH - 8}
              textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
              fontSize={10}
              fill={CHROME.mutedInk}
            >
              {x}
            </text>
          ))}

          {/* Direct end label for a single series: the value the eye lands on. */}
          {singleSeries &&
            (() => {
              const s = series[0]!;
              const lastWithValue = [...s.points].reverse().find((p) => p.y !== null);
              if (!lastWithValue) return null;
              const i = s.points.lastIndexOf(lastWithValue);
              return (
                <text
                  x={xAt(i) - 8}
                  y={yAt(lastWithValue.y as number) - 10}
                  textAnchor="end"
                  fontSize={11}
                  fontWeight={600}
                  fill={CHROME.primaryInk}
                >
                  {fmt(lastWithValue.y as number)}
                </text>
              );
            })()}
        </svg>

        {hoverIndex !== null && cursor && (
          <ChartTooltip x={cursor.x} y={14}>
            <p className="font-semibold text-slate-900">{xLabels[hoverIndex]}</p>
            <ul className="mt-1 space-y-0.5">
              {series.map((s, si) => {
                const y = s.points[hoverIndex]?.y;
                return (
                  <li key={s.label} className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="h-2 w-2 flex-shrink-0 rounded-sm"
                      style={{
                        backgroundColor: s.color ?? CATEGORICAL[si % CATEGORICAL.length] ?? CATEGORICAL[0],
                      }}
                    />
                    <span className="text-slate-600">{s.label}</span>
                    <span className="ml-auto pl-2 font-semibold tabular-nums text-slate-900">
                      {y === null || y === undefined ? 'No data' : fmt(y)}
                    </span>
                  </li>
                );
              })}
            </ul>
            {yLabel && <p className="mt-1 text-[11px] text-slate-500">{yLabel}</p>}
          </ChartTooltip>
        )}
      </div>
    </ChartFrame>
  );
}

/** 12-point sparkline for a stat tile. No axis, no labels. */
export function Sparkline({
  values,
  width = 96,
  height = 24,
  color,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (present.length < 2) return null;
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = Math.max(max - min, 0.0001);
  const stroke = color ?? CATEGORICAL[0];

  const points = values
    .map((v, i) =>
      v === null
        ? null
        : `${(i / (values.length - 1)) * width},${height - ((v - min) / span) * (height - 4) - 2}`,
    )
    .filter(Boolean)
    .join(' ');

  const lastIndex = values.reduce<number>((acc, v, i) => (v !== null ? i : acc), 0);
  const lastValue = values[lastIndex];

  return (
    <svg width={width} height={height} aria-hidden className="block overflow-visible">
      <polyline
        fill="none"
        stroke={CHROME.baseline}
        strokeWidth={2}
        strokeLinecap="round"
        points={points}
      />
      {lastValue !== null && lastValue !== undefined && (
        <circle
          cx={(lastIndex / (values.length - 1)) * width}
          cy={height - ((lastValue - min) / span) * (height - 4) - 2}
          r={3}
          fill={stroke}
          stroke={CHROME.surface}
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
