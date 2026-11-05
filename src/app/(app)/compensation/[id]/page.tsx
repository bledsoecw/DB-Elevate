import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { getCompensationCycle } from '@/server/services/compensation';
import { canApproveCompensation } from '@/server/authz/policy';
import { isAppError } from '@/server/errors';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Grid,
  PageHeader,
  ProgressBar,
  StatTile,
} from '@/components/ui/primitives';
import { formatBasisPoints, formatMoney } from '@/lib/money';
import {
  COMPENSATION_CYCLE_STATUS_LABELS,
  type CompensationCycleStatus,
} from '@/lib/enums';
import { countLabel, formatDate, relativeDueLabel } from '@/lib/utils';
import { AllocationGrid, CycleControls } from './controls';
import { BudgetPanel } from './budgets';

export const metadata = { title: 'Compensation cycle' };

export default async function CompensationCyclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;

  let data;
  try {
    data = await getCompensationCycle(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }

  const { cycle, rows, budget, managerBudgets, ceiling, isAdmin } = data;
  const canApprove = canApproveCompensation(actor);

  const decided = rows.filter((r) => r.decidedBp !== null).length;
  const submitted = rows.filter((r) => ['SUBMITTED', 'APPROVED', 'APPLIED'].includes(r.status)).length;
  const overrides = rows.filter((r) => r.isOverride).length;
  const noScore = rows.filter((r) => r.performanceScore === null).length;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Compensation', href: '/compensation' }, { label: cycle.name }]}
        title={cycle.name}
        description={
          <>
            Effective {formatDate(cycle.effectiveDate)}
            {cycle.reviewCycle && (
              <>
                {' · informed by '}
                <Link href={`/reviews/cycles/${cycle.reviewCycle.id}`} className="underline">
                  {cycle.reviewCycle.name}
                </Link>
              </>
            )}
            {cycle.dueAt && <> · {relativeDueLabel(cycle.dueAt)}</>}
          </>
        }
        actions={
          <>
            <Badge
              tone={
                cycle.status === 'PLANNING'
                  ? 'info'
                  : cycle.status === 'IN_APPROVAL'
                    ? 'warning'
                    : cycle.status === 'APPLIED'
                      ? 'success'
                      : 'neutral'
              }
            >
              {COMPENSATION_CYCLE_STATUS_LABELS[cycle.status as CompensationCycleStatus] ??
                cycle.status}
            </Badge>
            <CycleControls
              cycleId={cycle.id}
              status={cycle.status}
              isAdmin={isAdmin}
              canSubmit={!isAdmin && cycle.status === 'PLANNING'}
              decided={decided}
              total={rows.length}
            />
          </>
        }
      />

      <Grid cols={4} className="mb-6">
        <StatTile
          label="Decided"
          value={decided}
          denominator={`of ${rows.length}`}
          tone={decided === rows.length ? 'success' : 'neutral'}
        />
        <StatTile label="Submitted" value={submitted} denominator={`of ${rows.length}`} />
        <StatTile
          label={isAdmin ? 'Total pool' : 'Your budget'}
          value={formatMoney(budget.poolMinor, { currency: cycle.currency, whole: true })}
          hint={
            ceiling === 'none'
              ? isAdmin
                ? 'No pool set on this cycle, so nothing is enforced at submission.'
                : 'No budget set for you, so nothing is enforced when you submit.'
              : ceiling === 'zero'
                ? 'Your budget for this cycle is zero, so every decision here has to be 0%.'
                : `${formatMoney(budget.remainingMinor, { currency: cycle.currency, whole: true })} left`
          }
          tone={budget.over ? 'danger' : ceiling === 'zero' ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Allocated"
          value={formatMoney(budget.allocatedMinor, { currency: cycle.currency, whole: true })}
          tone={budget.over ? 'danger' : 'neutral'}
          hint={
            budget.over
              ? `${formatMoney(budget.overBy, { currency: cycle.currency, whole: true })} over`
              : undefined
          }
        />
      </Grid>

      {ceiling === 'amount' && (
        <Card className="mb-5">
          <CardBody>
            <ProgressBar
              value={Math.min((budget.usedRatio ?? 0) * 100, 100)}
              label={`${formatMoney(budget.allocatedMinor, { currency: cycle.currency })} of ${formatMoney(budget.poolMinor, { currency: cycle.currency })} allocated`}
              tone={budget.over ? 'danger' : budget.usedRatio && budget.usedRatio > 0.95 ? 'warning' : 'brand'}
            />
            {budget.over && (
              <p className="mt-2 text-sm font-medium text-rose-700">
                {formatMoney(budget.overBy, { currency: cycle.currency })} over budget. You can keep
                working — the ceiling is checked when you submit, not while you are deciding.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {isAdmin && (
        <BudgetPanel
          cycleId={cycle.id}
          currency={cycle.currency}
          poolMinor={cycle.totalPoolMinor}
          rows={managerBudgets}
          editable={['DRAFT', 'PLANNING', 'IN_APPROVAL'].includes(cycle.status)}
        />
      )}

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="How the recommendation works">
        Each suggested increase comes from the performance band and where the person sits in their
        salary band, and every row shows the reasoning in words. It is a starting point, not a
        decision: change any number you disagree with. A figure that differs from the
        recommendation needs a sentence saying why, kept with the decision.
        {noScore > 0 && (
          <>
            {' '}
            <strong className="font-semibold">
              {countLabel(noScore, 'person', 'people')} here {noScore === 1 ? 'has' : 'have'} no
              released review
            </strong>
            , so no recommendation is offered for {noScore === 1 ? 'them' : 'them'} — decide on
            their own merits and record why.
          </>
        )}
      </Alert>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            illustration="results"
            title="Nobody to allocate"
            description="Nobody in this cycle reports to you, or the cycle has no participants."
          />
        </Card>
      ) : (
        <AllocationGrid
          currency={cycle.currency}
          rows={rows}
          canApprove={canApprove}
          cycleStatus={cycle.status}
        />
      )}

      {overrides > 0 && (
        <p className="mt-4 text-xs text-slate-500">
          {countLabel(overrides, 'decision')} differs from the recommendation. Each one carries a
          recorded reason, and both figures are kept so the override stays visible as an override.
        </p>
      )}
    </>
  );
}
