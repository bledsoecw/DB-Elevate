'use client';

import { useState } from 'react';
import { CHROME, sequentialStep, inkOn } from './palette';
import { ChartFrame, ChartTooltip, NoChartData } from './chart-frame';

export interface HeatCell {
  row: number;
  col: number;
  count: number;
  names?: string[];
}

/**
 * Two-dimensional grid of counts — the nine-box style view of performance
 * against potential, or any other pair of ordered bands.
 *
 * Magnitude is a single-hue sequential ramp, lightest for near-zero. Every cell
 * prints its count, so the reading never depends on judging a shade, and the
 * data-table view carries the same numbers.
 */
export function Heatmap({
  title,
  subtitle,
  rowLabels,
  colLabels,
  cells,
  footnote,
  rowAxisLabel,
  colAxisLabel,
  onCellHref,
}: {
  title: string;
  subtitle?: string;
  /** Bottom row first, so the grid reads like a chart rather than a table. */
  rowLabels: string[];
  colLabels: string[];
  cells: HeatCell[];
  footnote?: React.ReactNode;
  rowAxisLabel?: string;
  colAxisLabel?: string;
  onCellHref?: (row: number, col: number) => string | null;
}) {
  const [hover, setHover] = useState<{ cell: HeatCell; x: number; y: number } | null>(null);

  const total = cells.reduce((sum, c) => sum + c.count, 0);
  const max = Math.max(...cells.map((c) => c.count), 1);

  if (total === 0) {
    return (
      <ChartFrame title={title} subtitle={subtitle} footnote={footnote}>
        <NoChartData message="No finalized ratings to place on the grid yet." />
      </ChartFrame>
    );
  }

  const cellAt = (row: number, col: number) =>
    cells.find((c) => c.row === row && c.col === col) ?? { row, col, count: 0 };

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      footnote={footnote}
      table={{
        columns: ['', ...colLabels, 'Total'],
        rows: [...rowLabels].reverse().map((rl, displayIndex) => {
          const rowIndex = rowLabels.length - 1 - displayIndex;
          const rowCells = colLabels.map((_, ci) => cellAt(rowIndex, ci).count);
          return [rl, ...rowCells, rowCells.reduce((a, b) => a + b, 0)];
        }),
      }}
    >
      <div className="relative">
        <div className="flex gap-2">
          {rowAxisLabel && (
            <div
              className="flex flex-shrink-0 items-center justify-center text-[10px] font-medium uppercase tracking-wide"
              style={{ color: CHROME.mutedInk, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            >
              {rowAxisLabel}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {[...rowLabels].reverse().map((rl, displayIndex) => {
              const rowIndex = rowLabels.length - 1 - displayIndex;
              return (
                <div key={rl} className="flex items-stretch gap-0.5" style={{ marginBottom: 2 }}>
                  <span
                    className="flex w-24 flex-shrink-0 items-center justify-end pr-2 text-right text-[10px] leading-tight"
                    style={{ color: CHROME.mutedInk }}
                  >
                    {rl}
                  </span>
                  <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${colLabels.length}, minmax(0, 1fr))`, gap: 2 }}>
                    {colLabels.map((_, colIndex) => {
                      const cell = cellAt(rowIndex, colIndex);
                      const fill = cell.count === 0 ? '#f8fafc' : sequentialStep(cell.count / max);
                      const href = onCellHref?.(rowIndex, colIndex) ?? null;
                      const Tag = href ? 'a' : 'div';
                      return (
                        <Tag
                          key={colIndex}
                          {...(href ? { href } : {})}
                          className="flex h-14 items-center justify-center rounded-sm transition hover:ring-2 hover:ring-brand-400"
                          style={{ backgroundColor: fill }}
                          aria-label={`${rowLabels[rowIndex]}, ${colLabels[colIndex]}: ${cell.count} ${cell.count === 1 ? 'person' : 'people'}`}
                          onMouseEnter={(e) => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const parent = (
                              e.currentTarget.closest('.relative') as HTMLElement
                            )?.getBoundingClientRect();
                            if (parent) {
                              setHover({
                                cell,
                                x: rect.left - parent.left + rect.width / 2,
                                y: rect.top - parent.top,
                              });
                            }
                          }}
                          onMouseLeave={() => setHover(null)}
                        >
                          <span
                            className="text-sm font-semibold tabular-nums"
                            style={{
                              color: cell.count === 0 ? CHROME.mutedInk : inkOn(fill),
                            }}
                          >
                            {cell.count === 0 ? '·' : cell.count}
                          </span>
                        </Tag>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="flex gap-0.5">
              <span className="w-24 flex-shrink-0" />
              <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${colLabels.length}, minmax(0, 1fr))`, gap: 2 }}>
                {colLabels.map((cl) => (
                  <span
                    key={cl}
                    className="pt-1.5 text-center text-[10px] leading-tight"
                    style={{ color: CHROME.mutedInk }}
                  >
                    {cl}
                  </span>
                ))}
              </div>
            </div>
            {colAxisLabel && (
              <p
                className="mt-1 text-center text-[10px] font-medium uppercase tracking-wide"
                style={{ color: CHROME.mutedInk }}
              >
                {colAxisLabel}
              </p>
            )}
          </div>
        </div>

        {hover && (
          <ChartTooltip x={hover.x} y={hover.y}>
            <p className="font-semibold text-slate-900">
              {rowLabels[hover.cell.row]} · {colLabels[hover.cell.col]}
            </p>
            <p className="mt-0.5 tabular-nums text-slate-700">
              {hover.cell.count} of {total} {hover.cell.count === 1 ? 'person' : 'people'}
            </p>
            {hover.cell.names && hover.cell.names.length > 0 && (
              <p className="mt-1 leading-snug text-slate-500">{hover.cell.names.join(', ')}</p>
            )}
          </ChartTooltip>
        )}
      </div>
    </ChartFrame>
  );
}
