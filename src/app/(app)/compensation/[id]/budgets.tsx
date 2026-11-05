'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, Input } from '@/components/ui/form';
import { Badge, Card, CardBody, CardHeader, TableWrap, Td, Th } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/client-api';
import { formatMoney, parseMoneyToMinor } from '@/lib/money';

export interface BudgetRow {
  managerId: string;
  managerName: string;
  headcount: number;
  decided: number;
  payrollMinor: number;
  poolMinor: number;
  allocatedMinor: number;
  remainingMinor: number;
  over: boolean;
  unset: boolean;
}

/**
 * Per-manager budgets, for the administrator who has to set them.
 *
 * The sum of the budgets is shown against the cycle pool, because those two
 * numbers are allowed to differ and an administrator needs to see when they do:
 * handing out more than the pool is a decision, not an error, but it should be
 * a visible one.
 */
export function BudgetPanel({
  cycleId,
  currency,
  poolMinor,
  rows,
  editable,
}: {
  cycleId: string;
  currency: string;
  poolMinor: number;
  rows: BudgetRow[];
  editable: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<BudgetRow | null>(null);
  const [splitting, setSplitting] = useState(false);

  const handedOut = rows.reduce((sum, r) => sum + r.poolMinor, 0);
  const difference = handedOut - poolMinor;
  const unsetCount = rows.filter((r) => r.unset).length;

  async function split() {
    setSplitting(true);
    try {
      const result = await api.post<{ managers: number; allocatedMinor: number }>(
        `/api/compensation/${cycleId}/budget/split`,
      );
      toast.success(
        'Pool divided between managers',
        `${result.managers} budget${result.managers === 1 ? '' : 's'} set, totalling ${formatMoney(result.allocatedMinor, { currency, whole: true })}.`,
      );
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSplitting(false);
    }
  }

  return (
    <>
      <Card className="mb-5">
        <CardHeader
          title="Manager budgets"
          description="What each manager has to spend. The ceiling is checked when they submit, not while they are deciding."
          actions={
            editable && poolMinor > 0 ? (
              <Button size="sm" onClick={split} loading={splitting}>
                Divide pool by payroll
              </Button>
            ) : undefined
          }
        />

        {rows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-slate-600">
              Nobody in this cycle has a manager recorded, so there is nobody to give a budget to.
            </p>
          </CardBody>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Manager</Th>
                  <Th align="right">People</Th>
                  <Th align="right">Payroll in scope</Th>
                  <Th align="right">Budget</Th>
                  <Th align="right">Allocated</Th>
                  <Th align="right">Left</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.managerId}>
                    <Td>
                      <p className="font-medium text-slate-900">{r.managerName}</p>
                      {r.headcount === 0 && (
                        <p className="text-xs text-amber-700">
                          Has a budget but nobody to allocate for
                        </p>
                      )}
                    </Td>
                    <Td align="right">
                      <span className="tabular-nums text-sm text-slate-700">
                        {r.decided} of {r.headcount}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="tabular-nums text-sm text-slate-600">
                        {formatMoney(r.payrollMinor, { currency, whole: true })}
                      </span>
                    </Td>
                    <Td align="right">
                      {r.unset ? (
                        <Badge tone="warning">Not set</Badge>
                      ) : r.poolMinor === 0 ? (
                        <Badge tone="danger">Nothing to give</Badge>
                      ) : (
                        <span className="tabular-nums text-sm font-medium text-slate-900">
                          {formatMoney(r.poolMinor, { currency, whole: true })}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      <span className="tabular-nums text-sm text-slate-800">
                        {formatMoney(r.allocatedMinor, { currency, whole: true })}
                      </span>
                    </Td>
                    <Td align="right">
                      {r.unset ? (
                        <span className="text-xs text-slate-500">No ceiling</span>
                      ) : (
                        <span
                          className={
                            'tabular-nums text-sm ' +
                            (r.over ? 'font-medium text-rose-700' : 'text-slate-600')
                          }
                        >
                          {r.over
                            ? `${formatMoney(-r.remainingMinor, { currency, whole: true })} over`
                            : formatMoney(r.remainingMinor, { currency, whole: true })}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      {editable && (
                        <Button size="sm" onClick={() => setEditing(r)}>
                          {r.unset ? 'Set' : 'Change'}
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>

            <CardBody className="border-t border-slate-100">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-600">
                <Scale aria-hidden className="mt-px h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  {formatMoney(handedOut, { currency, whole: true })} handed out against a pool of{' '}
                  {formatMoney(poolMinor, { currency, whole: true })}
                  {difference === 0 ? (
                    <> — they match.</>
                  ) : difference > 0 ? (
                    <>
                      {' '}
                      —{' '}
                      <strong className="font-semibold text-amber-700">
                        {formatMoney(difference, { currency, whole: true })} more than the pool
                      </strong>
                      . That is allowed; nothing stops you, but it is worth knowing.
                    </>
                  ) : (
                    <>
                      {' '}
                      — {formatMoney(-difference, { currency, whole: true })} of the pool is still
                      unassigned.
                    </>
                  )}
                  {unsetCount > 0 && (
                    <>
                      {' '}
                      {unsetCount} manager{unsetCount === 1 ? '' : 's'} with no budget set, so no
                      ceiling is enforced when they submit. A budget of zero is a different thing —
                      it means they may not give out anything.
                    </>
                  )}
                </span>
              </p>
            </CardBody>
          </>
        )}
      </Card>

      {editing && (
        <BudgetDialog
          cycleId={cycleId}
          currency={currency}
          row={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function BudgetDialog({
  cycleId,
  currency,
  row,
  onClose,
}: {
  cycleId: string;
  currency: string;
  row: BudgetRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(row.unset ? '' : String(row.poolMinor / 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poolMinor = value.trim() === '' ? null : parseMoneyToMinor(value);
  const invalid = value.trim() !== '' && (poolMinor === null || poolMinor < 0);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/compensation/${cycleId}/budget`, { ownerEmployeeId: row.managerId });
      toast.success(
        `Budget removed for ${row.managerName}.`,
        'No ceiling is enforced for them at submission.',
      );
      router.refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function save() {
    if (invalid || poolMinor === null) {
      setError('Enter an amount, like 12000, or remove the budget to leave them unconstrained.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/compensation/${cycleId}/budget`, {
        ownerEmployeeId: row.managerId,
        poolMinor,
      });
      toast.success(`Budget set for ${row.managerName}.`);
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
      title={`Budget for ${row.managerName}`}
      description={`${row.headcount} ${row.headcount === 1 ? 'person' : 'people'} to allocate for, ${formatMoney(row.payrollMinor, { currency, whole: true })} of payroll.`}
      footer={
        <>
          {!row.unset && (
            <Button variant="danger" onClick={remove} disabled={busy}>
              Remove budget
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={invalid}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Budget"
          htmlFor="budget-pool"
          required
          help="Zero is a real ceiling of zero: every increase in this manager’s scope would have to be 0%. To leave them unconstrained instead, remove the budget."
          error={invalid ? 'Enter an amount, like 12000.' : null}
          hint={poolMinor !== null && !invalid ? formatMoney(poolMinor, { currency, whole: true }) : undefined}
        >
          <Input
            id="budget-pool"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="12000"
          />
        </Field>

        {poolMinor === 0 && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            A budget of zero means this manager cannot give anybody an increase: every decision in
            their scope has to be 0%, and they will be refused at submission otherwise. If you meant
            &ldquo;no limit&rdquo;, remove the budget instead.
          </p>
        )}

        {poolMinor !== null && poolMinor > 0 && !invalid && row.payrollMinor > 0 && (
          <p className="text-xs leading-relaxed text-slate-600">
            That is {((poolMinor / row.payrollMinor) * 100).toFixed(2)}% of the payroll in this
            manager&rsquo;s scope.
            {row.allocatedMinor > 0 && (
              <>
                {' '}
                They have already allocated{' '}
                {formatMoney(row.allocatedMinor, { currency, whole: true })}
                {poolMinor > 0 && row.allocatedMinor > poolMinor && (
                  <>
                    , which is{' '}
                    <strong className="font-semibold text-rose-700">
                      {formatMoney(row.allocatedMinor - poolMinor, { currency, whole: true })} over
                      this figure
                    </strong>
                    . They will be refused at submission until they are inside it
                  </>
                )}
                .
              </>
            )}
          </p>
        )}

        <FormError message={error} />
      </div>
    </Dialog>
  );
}
