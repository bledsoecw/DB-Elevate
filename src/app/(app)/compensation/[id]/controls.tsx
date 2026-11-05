'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Info, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, CardHeader, TableWrap, Td, Th } from '@/components/ui/primitives';
import { FormError, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/client-api';
import {
  COMPENSATION_PARTICIPANT_STATUS_LABELS,
  type CompensationParticipantStatus,
} from '@/lib/enums';
import {
  formatBasisPoints,
  formatMoney,
  increaseFromBasisPoints,
  parsePercentToBasisPoints,
} from '@/lib/money';

/**
 * The allocation grid.
 *
 * Money is handled in integer minor units throughout, including here: the
 * preview a manager sees while typing is computed with the same function the
 * server uses to store the figure, so what they are shown and what is saved
 * cannot differ by a cent.
 */

export interface AllocRow {
  id: string;
  employeeId: string;
  name: string;
  jobTitle: string | null;
  currency: string;
  currentBaseMinor: number;
  performanceScore: number | null;
  performanceBand: string | null;
  recommendedBp: number | null;
  recommendationNote: string;
  decidedBp: number | null;
  decidedAmountMinor: number | null;
  newBaseMinor: number | null;
  rationale: string | null;
  status: string;
  canEdit: boolean;
  isOverride: boolean;
}

export function AllocationGrid({
  currency,
  rows,
  canApprove,
  cycleStatus,
}: {
  currency: string;
  rows: AllocRow[];
  canApprove: boolean;
  cycleStatus: string;
}) {
  const [editing, setEditing] = useState<AllocRow | null>(null);
  const [approving, setApproving] = useState<AllocRow | null>(null);

  return (
    <>
      <Card>
        <CardHeader
          title="People"
          description={
            cycleStatus === 'PLANNING'
              ? 'Set an increase for each person. A 0% increase is a decision; leaving it blank is not.'
              : 'Allocation is closed for this cycle.'
          }
        />
        <TableWrap>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th align="right">Current</Th>
              <Th align="right">Suggested</Th>
              <Th align="right">Increase</Th>
              <Th align="right">New salary</Th>
              <Th>Status</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <Td>
                  <p className="font-medium text-slate-900">{row.name}</p>
                  <p className="text-xs text-slate-500">{row.jobTitle ?? 'No job title'}</p>
                  {row.performanceBand ? (
                    <Badge tone="neutral" className="mt-1">
                      {row.performanceBand.replace('_', ' ').toLowerCase()}
                    </Badge>
                  ) : (
                    <Badge tone="warning" className="mt-1" title="No released review">
                      No review score
                    </Badge>
                  )}
                </Td>

                <Td align="right">
                  <span className="text-slate-700">
                    {formatMoney(row.currentBaseMinor, { currency, whole: true })}
                  </span>
                </Td>

                <Td align="right">
                  {row.recommendedBp !== null ? (
                    <span className="text-slate-600" title={row.recommendationNote}>
                      {formatBasisPoints(row.recommendedBp)}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400" title={row.recommendationNote}>
                      none
                    </span>
                  )}
                </Td>

                <Td align="right">
                  {row.decidedBp !== null ? (
                    <>
                      <span className="font-semibold text-slate-900">
                        {formatBasisPoints(row.decidedBp)}
                      </span>
                      <p className="text-xs text-slate-500">
                        {formatMoney(row.decidedAmountMinor, { currency })}
                      </p>
                      {row.isOverride && (
                        <Badge tone="warning" className="mt-1">
                          Override
                        </Badge>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </Td>

                <Td align="right">
                  <span className={row.newBaseMinor ? 'font-medium text-slate-900' : 'text-slate-400'}>
                    {row.newBaseMinor
                      ? formatMoney(row.newBaseMinor, { currency, whole: true })
                      : '—'}
                  </span>
                </Td>

                <Td>
                  <Badge
                    tone={
                      row.status === 'APPLIED'
                        ? 'success'
                        : row.status === 'APPROVED'
                          ? 'success'
                          : row.status === 'CHANGES_REQUESTED'
                            ? 'danger'
                            : row.status === 'SUBMITTED'
                              ? 'info'
                              : 'neutral'
                    }
                  >
                    {COMPENSATION_PARTICIPANT_STATUS_LABELS[
                      row.status as CompensationParticipantStatus
                    ] ?? row.status}
                  </Badge>
                  {row.rationale && (
                    <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-slate-500">
                      {row.rationale}
                    </p>
                  )}
                </Td>

                <Td align="right">
                  <div className="flex flex-col items-end gap-1">
                    {row.canEdit && (
                      <Button size="sm" onClick={() => setEditing(row)}>
                        {row.decidedBp === null ? 'Decide' : 'Change'}
                      </Button>
                    )}
                    {canApprove && row.status === 'SUBMITTED' && (
                      <Button size="sm" variant="primary" onClick={() => setApproving(row)}>
                        Review
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {editing && (
        <AllocateDialog
          row={editing}
          currency={currency}
          onClose={() => setEditing(null)}
        />
      )}
      {approving && (
        <ApproveDialog row={approving} currency={currency} onClose={() => setApproving(null)} />
      )}
    </>
  );
}

function AllocateDialog({
  row,
  currency,
  onClose,
}: {
  row: AllocRow;
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pct, setPct] = useState(
    row.decidedBp !== null
      ? String(row.decidedBp / 100)
      : row.recommendedBp !== null
        ? String(row.recommendedBp / 100)
        : '',
  );
  const [rationale, setRationale] = useState(row.rationale ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bp = parsePercentToBasisPoints(pct);
  const amount = increaseFromBasisPoints(row.currentBaseMinor, bp);
  const newBase = amount === null ? null : row.currentBaseMinor + amount;
  const isOverride = bp !== null && row.recommendedBp !== null && bp !== row.recommendedBp;
  const needsReason = isOverride && rationale.trim().length === 0;
  const invalid = bp !== null && (bp < 0 || bp > 10_000);

  async function save(clear = false) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/compensation/allocate/${row.id}`, {
        bp: clear ? null : bp,
        rationale: clear ? null : rationale.trim() || null,
      });
      toast.success(clear ? 'Decision cleared.' : 'Decision recorded.');
      onClose();
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={row.name}
      description={row.jobTitle ?? undefined}
      footer={
        <>
          {row.decidedBp !== null && (
            <Button
              variant="ghost"
              className="mr-auto"
              icon={<Undo2 className="h-3.5 w-3.5" />}
              loading={busy}
              onClick={() => save(true)}
            >
              Clear
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel="Saving…"
            disabled={bp === null || invalid || needsReason}
            onClick={() => save(false)}
          >
            Record decision
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />

        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-start gap-2">
            <Info aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Suggested {row.recommendedBp !== null ? formatBasisPoints(row.recommendedBp) : '—'}
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-700">
                {row.recommendationNote}
              </p>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Current</dt>
            <dd className="mt-0.5 font-semibold text-slate-900">
              {formatMoney(row.currentBaseMinor, { currency, whole: true })}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Increase</dt>
            <dd className="mt-0.5 font-semibold text-slate-900">
              {amount === null ? '—' : formatMoney(amount, { currency })}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">New salary</dt>
            <dd className="mt-0.5 font-semibold text-slate-900">
              {newBase === null ? '—' : formatMoney(newBase, { currency, whole: true })}
            </dd>
          </div>
        </dl>

        <label className="block">
          <span className="block text-sm font-medium text-slate-800">Increase</span>
          <span className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              step={0.25}
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              aria-label={`Increase percentage for ${row.name}`}
              className="w-32 rounded-md border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
            />
            <span className="text-sm text-slate-600">%</span>
          </span>
          <span className="mt-1 block text-xs text-slate-500">
            A 0% increase is a decision and can be recorded as one. Leaving this blank is not.
          </span>
        </label>

        {isOverride && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            This differs from the suggested {formatBasisPoints(row.recommendedBp)}. Both figures are
            kept, so the override stays visible as one — say why below.
          </p>
        )}

        <Textarea
          label="Reason"
          required={isOverride}
          rows={3}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          help={
            isOverride
              ? 'Required when the figure differs from the recommendation. Kept with the decision.'
              : 'Optional, but useful to whoever reads this later.'
          }
        />
      </div>
    </Dialog>
  );
}

function ApproveDialog({
  row,
  currency,
  onClose,
}: {
  row: AllocRow;
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'APPROVE' | 'REQUEST_CHANGES') {
    setBusy(decision);
    setError(null);
    try {
      await api.post(`/api/compensation/approve/${row.id}`, { decision, note: note.trim() || null });
      toast.success(decision === 'APPROVE' ? 'Approved.' : 'Sent back to the manager.');
      onClose();
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Review: ${row.name}`}
      description="Approving says the number is right. It does not change anybody's pay — applying the cycle does that, as a separate step."
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto text-amber-800"
            loading={busy === 'REQUEST_CHANGES'}
            onClick={() => decide('REQUEST_CHANGES')}
          >
            Send back
          </Button>
          <Button onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Check className="h-4 w-4" />}
            loading={busy === 'APPROVE'}
            onClick={() => decide('APPROVE')}
          >
            Approve
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <dl className="grid grid-cols-2 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Current</dt>
            <dd className="mt-0.5 font-semibold">{formatMoney(row.currentBaseMinor, { currency, whole: true })}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Proposed</dt>
            <dd className="mt-0.5 font-semibold">
              {formatMoney(row.newBaseMinor, { currency, whole: true })}{' '}
              <span className="font-normal text-slate-500">
                ({formatBasisPoints(row.decidedBp)})
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Suggested was</dt>
            <dd className="mt-0.5">{formatBasisPoints(row.recommendedBp)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Performance</dt>
            <dd className="mt-0.5">{row.performanceBand ?? 'No released review'}</dd>
          </div>
        </dl>

        {row.rationale && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Manager&rsquo;s reason
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-700">{row.rationale}</p>
          </div>
        )}

        <Textarea
          label="Note"
          required={false}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          help="Required when sending back — the manager sees it."
        />
      </div>
    </Dialog>
  );
}

interface CycleActionResult {
  managersNotified?: number;
  submitted?: number;
  applied?: number;
  skipped?: number;
}

/**
 * Turns the action's result into a sentence. The raw counts matter — "applied"
 * and "skipped" are not the same thing, and an administrator who clicks Apply
 * needs to know if anything was left behind rather than assume it all went.
 */
function actionDetail(r: CycleActionResult): string | undefined {
  if (typeof r.managersNotified === 'number') {
    return `${r.managersNotified} manager${r.managersNotified === 1 ? '' : 's'} can now allocate.`;
  }
  if (typeof r.submitted === 'number') {
    return `${r.submitted} decision${r.submitted === 1 ? '' : 's'} sent for approval.`;
  }
  if (typeof r.applied === 'number') {
    const applied = `${r.applied} increase${r.applied === 1 ? '' : 's'} written to pay history`;
    return r.skipped
      ? `${applied}. ${r.skipped} left out — not yet approved.`
      : `${applied}.`;
  }
  return undefined;
}

export function CycleControls({
  cycleId,
  status,
  isAdmin,
  canSubmit,
  decided,
  total,
}: {
  cycleId: string;
  status: string;
  isAdmin: boolean;
  canSubmit: boolean;
  decided: number;
  total: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(path: string, label: string, key: string) {
    setBusy(key);
    try {
      const result = await api.post<CycleActionResult>(`/api/compensation/${cycleId}/${path}`);
      toast.success(label, actionDetail(result));
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {canSubmit && (
        <Button
          variant="primary"
          loading={busy === 'submit'}
          disabled={decided < total}
          title={decided < total ? `${total - decided} still undecided` : undefined}
          onClick={() => run('submit', 'Submitted for approval.', 'submit')}
        >
          Submit decisions
        </Button>
      )}
      {isAdmin && status === 'DRAFT' && (
        <Button
          variant="primary"
          loading={busy === 'launch'}
          onClick={() => run('launch', 'Managers notified.', 'launch')}
        >
          Open for allocation
        </Button>
      )}
      {isAdmin && status === 'PLANNING' && (
        <Button loading={busy === 'close'} onClick={() => run('close', 'Allocation closed.', 'close')}>
          Close allocation
        </Button>
      )}
      {isAdmin && ['IN_APPROVAL', 'APPROVED'].includes(status) && (
        <Button
          variant="primary"
          loading={busy === 'apply'}
          onClick={() => run('apply', 'Applied to pay records.', 'apply')}
        >
          Apply to pay
        </Button>
      )}
    </>
  );
}
