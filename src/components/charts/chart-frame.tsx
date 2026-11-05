'use client';

import { useState, type ReactNode } from 'react';
import { Table2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CHROME } from './palette';

/**
 * Shared wrapper for every chart.
 *
 * It provides the four things the visualization standard requires around a
 * plot and which are easy to forget per-chart:
 *
 *  1. A title that names what is plotted (so a single-series chart needs no
 *     legend box).
 *  2. A legend for two or more series, present always — identity is never
 *     carried by colour alone.
 *  3. A data-table view, which is both the accessibility fallback and the
 *     relief required for a series colour below 3:1 contrast.
 *  4. A footnote slot for the denominator and the calculation rule, because a
 *     percentage without its basis is a misleading number.
 */

export interface LegendEntry {
  label: string;
  color: string;
  /** Written out beside the swatch when the colour is a reserved status. */
  note?: string;
}

export function ChartFrame({
  title,
  subtitle,
  legend,
  footnote,
  table,
  children,
  className,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Omit for a single series — the title already names it. */
  legend?: LegendEntry[];
  /** Denominator and calculation rule. Strongly encouraged. */
  footnote?: ReactNode;
  /** Rows backing the chart; shown when the reader opens the table view. */
  table?: { columns: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <figure className={cn('m-0', className)}>
      <figcaption className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{subtitle}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {actions}
          {table && (
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              aria-pressed={showTable}
              className="no-print inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 hover:text-slate-900"
            >
              {showTable ? (
                <>
                  <X aria-hidden className="h-3.5 w-3.5" />
                  Hide data
                </>
              ) : (
                <>
                  <Table2 aria-hidden className="h-3.5 w-3.5" />
                  Show data
                </>
              )}
            </button>
          )}
        </div>
      </figcaption>

      {legend && legend.length >= 2 && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span
                aria-hidden
                className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                style={{ backgroundColor: l.color }}
              />
              <span>{l.label}</span>
              {l.note && <span className="text-slate-400">({l.note})</span>}
            </li>
          ))}
        </ul>
      )}

      <div className={showTable ? 'hidden' : 'block'}>{children}</div>

      {table && (
        <div className={cn('scroll-thin overflow-x-auto', showTable ? 'block' : 'hidden')}>
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th
                    key={c}
                    scope="col"
                    className={cn(
                      'bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600',
                      i === 0 ? 'text-left' : 'text-right',
                    )}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {table.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        'px-3 py-1.5',
                        ci === 0
                          ? 'text-left font-medium text-slate-800'
                          : 'text-right tabular-nums text-slate-700',
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {footnote && (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">{footnote}</p>
      )}
    </figure>
  );
}

/** Floating tooltip positioned by the chart that owns it. */
export function ChartTooltip({
  x,
  y,
  children,
  align = 'center',
}: {
  x: number;
  y: number;
  children: ReactNode;
  align?: 'center' | 'left';
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 max-w-[16rem] rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs shadow-pop"
      style={{
        left: x,
        top: y,
        transform: align === 'center' ? 'translate(-50%, -100%)' : 'translate(0, -100%)',
      }}
    >
      {children}
    </div>
  );
}

export function NoChartData({ message }: { message?: string }) {
  return (
    <div
      className="flex min-h-[8rem] items-center justify-center rounded-md border border-dashed px-4 py-6 text-center text-xs text-slate-500"
      style={{ borderColor: CHROME.gridline }}
    >
      {message ?? 'No data to chart yet.'}
    </div>
  );
}
