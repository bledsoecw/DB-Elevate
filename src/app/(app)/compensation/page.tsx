import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listCompensationCycles } from '@/server/services/compensation';
import { canAdministerCompensation } from '@/server/authz/policy';
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  ProgressBar,
} from '@/components/ui/primitives';
import { formatMoney } from '@/lib/money';
import {
  COMPENSATION_CYCLE_STATUS_LABELS,
  type CompensationCycleStatus,
} from '@/lib/enums';
import { countLabel, formatDate, relativeDueLabel } from '@/lib/utils';

export const metadata = { title: 'Compensation' };

export default async function CompensationPage() {
  const actor = await requireActor();
  const isAdmin = canAdministerCompensation(actor);
  const cycles = await listCompensationCycles(actor);

  // Somebody with neither the role nor an allocation has nothing here, and
  // should be sent to their own pay rather than shown an empty admin screen.
  if (!isAdmin && cycles.length === 0) redirect('/compensation/me');

  const open = cycles.filter((c) => !['APPLIED', 'CANCELLED'].includes(c.status));
  const done = cycles.filter((c) => ['APPLIED', 'CANCELLED'].includes(c.status));

  return (
    <>
      <PageHeader
        title="Compensation"
        description={
          isAdmin
            ? 'Merit cycles, budgets and pay history.'
            : 'Pay decisions waiting on you for the people you manage.'
        }
        actions={
          <>
            <ButtonLink href="/compensation/me">My pay</ButtonLink>
            {isAdmin && (
              <ButtonLink href="/compensation/new" variant="primary">
                New cycle
              </ButtonLink>
            )}
          </>
        }
      />

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="Who can see salary here">
        Compensation is a separate role from HR, deliberately. An HR administrator runs the
        performance programme and does not get salary; a compensation administrator gets salary and
        does not get review content. A manager sees current pay for the people they are allocating,
        only while a cycle is open, and only for the reporting line as it stood when that cycle
        launched. Everyone can see their own pay.
      </Alert>

      {cycles.length === 0 ? (
        <Card>
          <EmptyState
            illustration="results"
            title="No compensation cycles yet"
            description="A cycle takes a group of people, gives each manager a budget, and collects a decision for every person — informed by their released review, never set by it."
            action={
              isAdmin ? (
                <ButtonLink href="/compensation/new" variant="primary">
                  Open a cycle
                </ButtonLink>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {open.map((c) => {
            const pct = c.mine > 0 ? (c.decided / c.mine) * 100 : 0;
            return (
              <Card key={c.id}>
                <CardHeader
                  title={
                    <Link href={`/compensation/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  }
                  description={
                    <>
                      Effective {formatDate(c.effectiveDate)}
                      {c.reviewCycle && <> · informed by {c.reviewCycle.name}</>}
                      {c.dueAt && <> · {relativeDueLabel(c.dueAt)}</>}
                    </>
                  }
                  actions={
                    <>
                      <Badge
                        tone={
                          c.status === 'PLANNING'
                            ? 'info'
                            : c.status === 'IN_APPROVAL'
                              ? 'warning'
                              : c.status === 'APPROVED'
                                ? 'success'
                                : 'neutral'
                        }
                      >
                        {COMPENSATION_CYCLE_STATUS_LABELS[c.status as CompensationCycleStatus] ??
                          c.status}
                      </Badge>
                      <ButtonLink href={`/compensation/${c.id}`} size="sm">
                        Open
                      </ButtonLink>
                    </>
                  }
                />
                <CardBody>
                  <ProgressBar
                    value={pct}
                    label={`${c.decided} of ${c.mine} decided`}
                    tone={c.decided === c.mine ? 'success' : 'brand'}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-600">
                    <span>{countLabel(c.mine, 'person', 'people')} in your scope</span>
                    <span>{c.submitted} submitted</span>
                    {isAdmin && (
                      <span>
                        Pool {formatMoney(c.totalPoolMinor, { currency: c.currency, whole: true })}
                      </span>
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })}

          {done.length > 0 && (
            <Card>
              <CardHeader title="Closed" description="Applied to pay records, or cancelled." />
              <ul className="divide-y divide-slate-100">
                {done.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/compensation/${c.id}`}
                        className="text-sm font-medium text-slate-800 hover:underline"
                      >
                        {c.name}
                      </Link>
                      <p className="text-xs text-slate-500">
                        Effective {formatDate(c.effectiveDate)} ·{' '}
                        {countLabel(c._count.participants, 'person', 'people')}
                      </p>
                    </div>
                    <Badge tone="neutral">
                      {COMPENSATION_CYCLE_STATUS_LABELS[c.status as CompensationCycleStatus] ??
                        c.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <p className="mt-6 flex max-w-3xl items-start gap-2 text-xs leading-relaxed text-slate-500">
        <Wallet aria-hidden className="mt-px h-3.5 w-3.5 flex-shrink-0" />
        <span>
          Approving a decision and applying it are separate steps. Approving says the number is
          right; applying writes it to pay history, which is append-only — a correction is a new
          row, never an edit, so what somebody was paid on any past date always has an answer.
        </span>
      </p>
    </>
  );
}
