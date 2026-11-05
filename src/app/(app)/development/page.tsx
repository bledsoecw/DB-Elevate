import Link from 'next/link';
import { Lock, Sprout } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listPlans } from '@/server/services/development';
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkTabs,
  PageHeader,
  ProgressBar,
} from '@/components/ui/primitives';
import { PLAN_STATUS_LABELS, PLAN_TYPE_LABELS, type PlanStatus, type PlanType } from '@/lib/enums';
import { countLabel, formatDate, fullName, isOverdue, relativeDueLabel } from '@/lib/utils';

export const metadata = { title: 'Development' };

type Scope = 'mine' | 'team' | 'all';

export default async function DevelopmentPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const actor = await requireActor();
  const { scope: raw } = await searchParams;
  const scope: Scope = raw === 'team' ? 'team' : raw === 'all' ? 'all' : 'mine';

  const [mine, team, all] = await Promise.all([
    listPlans(actor, { scope: 'mine' }),
    actor.isManager ? listPlans(actor, { scope: 'team' }) : Promise.resolve([]),
    actor.isHrAdmin || actor.isManager ? listPlans(actor, { scope: 'all' }) : Promise.resolve([]),
  ]);

  const tabs = [{ key: 'mine', label: 'Mine', href: '/development', count: mine.length }];
  if (actor.isManager) {
    tabs.push({ key: 'team', label: 'My team', href: '/development?scope=team', count: team.length });
  }
  if (actor.isHrAdmin || actor.isManager) {
    tabs.push({
      key: 'all',
      label: actor.isHrAdmin ? 'Everyone' : 'Everything I can see',
      href: '/development?scope=all',
      count: all.length,
    });
  }

  const plans = scope === 'mine' ? mine : scope === 'team' ? team : all;
  const open = plans.filter((p) => p.status === 'DRAFT' || p.status === 'ACTIVE');
  const closed = plans.filter((p) => p.status === 'COMPLETED' || p.status === 'CANCELLED');

  return (
    <>
      <PageHeader
        title="Development"
        description="Plans for building skill, and the restricted kind used when performance has to improve. Both carry actions, a target date and a check-in history."
        actions={
          <ButtonLink href="/development/new" variant="primary">
            New plan
          </ButtonLink>
        }
      />

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="Who can see what">
        A <strong className="font-semibold">development plan</strong> is collaborative: you, your
        management chain and HR can read it, and you can work it yourself. A{' '}
        <strong className="font-semibold">performance improvement plan</strong> is a restricted
        personnel record — visible only to the employee, their direct manager and HR, not the wider
        chain and not leadership. You can record progress against your own improvement plan but not
        change its terms, which is the distinction between showing you have met it and rewriting what
        it asked for.
      </Alert>

      {tabs.length > 1 && <LinkTabs tabs={tabs} current={scope} className="mb-5" />}

      {plans.length === 0 ? (
        <Card>
          <EmptyState
            illustration="plans"
            icon={<Sprout className="h-5 w-5" />}
            title={
              scope === 'mine'
                ? 'You have no development plans'
                : scope === 'team'
                  ? 'Nobody on your team has a plan'
                  : 'No plans yet'
            }
            description={
              scope === 'mine'
                ? 'A plan is a short list of things you are actually going to do, with dates. Start one yourself, or ask your manager.'
                : 'Start one with someone when there is a skill worth building deliberately rather than hoping it happens.'
            }
            action={<ButtonLink href="/development/new" variant="primary">Start a plan</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {open.map((plan) => (
            <PlanCard key={plan.id} plan={plan} showPerson={scope !== 'mine'} />
          ))}

          {closed.length > 0 && (
            <Card>
              <CardHeader
                title="Closed"
                description="Kept with their recorded outcome. A closed plan is history, not clutter."
              />
              <ul className="divide-y divide-slate-100">
                {closed.map((plan) => (
                  <li key={plan.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/development/${plan.id}`}
                        className="text-sm font-medium text-slate-800 hover:underline"
                      >
                        {plan.title}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {scope !== 'mine' && <>{fullName(plan.employee)} · </>}
                        {PLAN_TYPE_LABELS[plan.planType as PlanType]}
                        {plan.closedAt && <> · closed {formatDate(plan.closedAt)}</>}
                      </p>
                    </div>
                    <Badge tone={plan.status === 'COMPLETED' ? 'success' : 'neutral'}>
                      {PLAN_STATUS_LABELS[plan.status as PlanStatus]}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

type PlanRow = Awaited<ReturnType<typeof listPlans>>[number];

function PlanCard({ plan, showPerson }: { plan: PlanRow; showPerson: boolean }) {
  const isPip = plan.planType === 'PERFORMANCE_IMPROVEMENT';
  const done = plan.actions.filter((a) => a.status === 'COMPLETED').length;
  const cancelled = plan.actions.filter((a) => a.status === 'CANCELLED').length;
  const counted = plan.actions.length - cancelled;
  const overdue = plan.actions.filter(
    (a) => a.status !== 'COMPLETED' && a.status !== 'CANCELLED' && isOverdue(a.dueDate),
  ).length;

  return (
    <Card className={isPip ? 'border-amber-200' : undefined}>
      <CardHeader
        title={
          <Link href={`/development/${plan.id}`} className="hover:underline">
            {plan.title}
          </Link>
        }
        description={
          <>
            {showPerson && (
              <>
                <Link href={`/people/${plan.employee.id}`} className="font-medium hover:underline">
                  {fullName(plan.employee)}
                </Link>
                {plan.employee.jobTitle && <> · {plan.employee.jobTitle.name}</>}
                {' · '}
              </>
            )}
            {plan.description ?? PLAN_TYPE_LABELS[plan.planType as PlanType]}
          </>
        }
        actions={
          <>
            {isPip && (
              <Badge tone="warning" title="Restricted to the employee, their direct manager and HR">
                <Lock aria-hidden className="mr-1 inline h-3 w-3" />
                Restricted
              </Badge>
            )}
            <Badge tone={plan.status === 'ACTIVE' ? 'info' : 'neutral'}>
              {PLAN_STATUS_LABELS[plan.status as PlanStatus]}
            </Badge>
            <ButtonLink href={`/development/${plan.id}`} size="sm">
              Open
            </ButtonLink>
          </>
        }
      />
      <CardBody>
        {counted > 0 ? (
          <>
            <ProgressBar
              value={(done / counted) * 100}
              label={`${done} of ${counted} actions complete`}
            />
            <p className="mt-1 text-xs text-slate-500">
              Denominator: {countLabel(counted, 'action')} still counted
              {cancelled > 0 && <> ({cancelled} cancelled and excluded)</>}.
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-500">
            No actions yet — a plan without actions is an intention.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-600">
          {plan.targetDate && (
            <span className={isOverdue(plan.targetDate) && plan.status === 'ACTIVE' ? 'font-medium text-rose-700' : ''}>
              Target {relativeDueLabel(plan.targetDate)}
            </span>
          )}
          {overdue > 0 && (
            <span className="font-medium text-amber-700">
              {countLabel(overdue, 'overdue action')}
            </span>
          )}
          <span>{countLabel(plan._count.checkIns, 'check-in')}</span>
        </div>
      </CardBody>
    </Card>
  );
}
