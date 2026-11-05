'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, Input } from '@/components/ui/form';
import { Badge, Card, CardHeader, TableWrap, Td, Th } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/client-api';
import { bandMidpoint, compaRatio, formatMoney, parseMoneyToMinor } from '@/lib/money';

export interface BandRow {
  jobTitleId: string;
  name: string;
  level: string | null;
  department: string | null;
  headcount: number;
  band: {
    id: string;
    currency: string;
    minMinor: number;
    midMinor: number | null;
    maxMinor: number;
    effectiveFrom: Date;
  } | null;
}

export function BandTable({ rows }: { rows: BandRow[] }) {
  const [editing, setEditing] = useState<BandRow | null>(null);

  return (
    <>
      <Card>
        <CardHeader
          title="Job titles"
          description="A title with no band is listed too, because the absence is the thing worth seeing."
        />
        <TableWrap>
          <thead>
            <tr>
              <Th>Job title</Th>
              <Th>Department</Th>
              <Th align="right">People</Th>
              <Th align="right">Minimum</Th>
              <Th align="right">Midpoint</Th>
              <Th align="right">Maximum</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.jobTitleId}>
                <Td>
                  <p className="font-medium text-slate-900">{row.name}</p>
                  {row.level && <p className="text-xs text-slate-500">{row.level}</p>}
                </Td>
                <Td>
                  <span className="text-sm text-slate-600">{row.department ?? '—'}</span>
                </Td>
                <Td align="right">
                  <span className="tabular-nums text-sm text-slate-700">{row.headcount}</span>
                </Td>
                {row.band ? (
                  <>
                    <Td align="right">
                      <span className="tabular-nums text-sm text-slate-800">
                        {formatMoney(row.band.minMinor, { currency: row.band.currency, whole: true })}
                      </span>
                    </Td>
                    <Td align="right">
                      <MidpointCell band={row.band} />
                    </Td>
                    <Td align="right">
                      <span className="tabular-nums text-sm text-slate-800">
                        {formatMoney(row.band.maxMinor, { currency: row.band.currency, whole: true })}
                      </span>
                    </Td>
                  </>
                ) : (
                  <Td colSpan={3}>
                    <span className="flex items-center gap-2">
                      <Badge tone="warning">No band set</Badge>
                      <span className="text-xs text-slate-500">
                        No range agreed, so position in band is not an input here
                      </span>
                    </span>
                  </Td>
                )}
                <Td align="right">
                  <Button size="sm" onClick={() => setEditing(row)}>
                    {row.band ? 'Edit' : 'Set band'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {editing && <BandDialog row={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function MidpointCell({ band }: { band: NonNullable<BandRow['band']> }) {
  const mid = bandMidpoint(band.minMinor, band.maxMinor, band.midMinor);
  if (!mid) return <span className="text-sm text-slate-400">—</span>;
  return (
    <>
      <span className="tabular-nums text-sm text-slate-600">
        {formatMoney(mid.minor, { currency: band.currency, whole: true })}
      </span>
      {!mid.agreed && (
        <span
          className="ml-1 text-xs text-slate-400"
          title="Halfway between the minimum and the maximum, because no midpoint was agreed"
        >
          halfway
        </span>
      )}
    </>
  );
}

function minorToField(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  return String(minor / 100);
}

function BandDialog({ row, onClose }: { row: BandRow; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();

  const [min, setMin] = useState(minorToField(row.band?.minMinor));
  const [mid, setMid] = useState(minorToField(row.band?.midMinor));
  const [max, setMax] = useState(minorToField(row.band?.maxMinor));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minMinor = parseMoneyToMinor(min);
  const midMinor = mid.trim() === '' ? null : parseMoneyToMinor(mid);
  const maxMinor = parseMoneyToMinor(max);

  const problem =
    minMinor === null || maxMinor === null
      ? 'Enter a minimum and a maximum.'
      : maxMinor < minMinor
        ? 'The maximum cannot be below the minimum.'
        : mid.trim() !== '' && midMinor === null
          ? 'The midpoint is not a number I can read.'
          : midMinor !== null && (midMinor < minMinor || midMinor > maxMinor)
            ? 'The midpoint has to sit inside the band.'
            : null;

  // Shown so the effect on existing people is visible before saving, not after,
  // and measured with the same function the recommendation uses.
  const preview = (() => {
    if (problem || minMinor === null || maxMinor === null) return null;
    const mid = bandMidpoint(minMinor, maxMinor, midMinor);
    if (!mid) return null;
    const atMin = compaRatio(minMinor, minMinor, maxMinor, midMinor);
    const atMax = compaRatio(maxMinor, minMinor, maxMinor, midMinor);
    if (atMin === null || atMax === null) return null;
    return { min: minMinor, max: maxMinor, mid, atMin, atMax };
  })();

  async function save() {
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/compensation/bands/${row.jobTitleId}`, {
        minMinor,
        midMinor,
        maxMinor,
      });
      toast.success(
        row.band ? `Band revised for ${row.name}.` : `Band set for ${row.name}.`,
        'Open cycles keep the range they were launched against.',
      );
      router.refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/compensation/bands/${row.jobTitleId}`);
      toast.success(`Band removed for ${row.name}.`);
      router.refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row.band ? `Band for ${row.name}` : `Set a band for ${row.name}`}
      description={
        row.headcount === 0
          ? 'Nobody currently holds this title.'
          : `${row.headcount} ${row.headcount === 1 ? 'person holds' : 'people hold'} this title.`
      }
      footer={
        <>
          {row.band && (
            <Button variant="danger" onClick={remove} disabled={busy}>
              Remove band
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={problem !== null}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Minimum" htmlFor="band-min" required>
            <Input id="band-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
          </Field>
          <Field label="Midpoint" htmlFor="band-mid" required={false}>
            <Input
              id="band-mid"
              inputMode="decimal"
              value={mid}
              onChange={(e) => setMid(e.target.value)}
              placeholder="auto"
            />
          </Field>
          <Field label="Maximum" htmlFor="band-max" required>
            <Input id="band-max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
          </Field>
        </div>

        {preview && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            <p className="tabular-nums">
              {formatMoney(preview.min, { whole: true })} – {formatMoney(preview.max, { whole: true })}
              <span className="text-slate-500">
                {' · midpoint '}
                {formatMoney(preview.mid.minor, { whole: true })}
                {!preview.mid.agreed && ' (halfway)'}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Position in band is measured against that midpoint. Somebody paid the minimum would
              sit at {Math.round(preview.atMin * 100)}%, and the maximum at{' '}
              {Math.round(preview.atMax * 100)}%.
            </p>
          </div>
        )}

        <p className="text-xs leading-relaxed text-slate-500">
          Midpoint is optional. Left blank, halfway between the minimum and the maximum is used and
          labelled as implied, so nobody mistakes a derived figure for an agreed one.
        </p>

        <FormError message={error} />
      </div>
    </Dialog>
  );
}
