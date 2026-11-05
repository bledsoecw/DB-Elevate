import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Lock } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { getPlan } from '@/server/services/development';
import { isAppError } from '@/server/errors';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DetailItem,
  DetailList,
  PageHeader,
  ProgressBar,
  ProseText,
} from '@/components/ui/primitives';
import { PLAN_STATUS_LABELS, PLAN_TYPE_LABELS, type PlanStatus, type PlanType } from '@/lib/enums';
import {
  countLabel,
  formatDate,
  formatRelativeTime,
  fullName,
  isOverdue,
  relativeDueLabel,
} from '@/lib/utils';
import { ActionList, CheckInForm, PlanStatusControls } from './controls';

export const metadata = { title: 'Development plan' };

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;

  let plan;
  try {
    plan = await getPlan(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }

  const isPip = plan.planType === 'PERFORMANCE_IMPROVEMENT';
  const closed = plan.status === 'COMPLETED' || plan.status === 'CANCELLED';
  const cancelled = plan.actions.filter((a) => a.status === 'CANCELLED').length;
  const counted = plan.actions.length - cancelled;
  const done = plan.actions.filter((a) => a.status === 'COMPLETED').length;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Development', href: '/development' }, { label: plan.title }]}
        title={plan.title}
        description={
          <>
            <Link href={`/people/${plan.employee.id}`} className="font-medium underline">
              {fullName(plan.employee)}
            </Link>
            {plan.employee.jobTitle && <> · {plan.employee.jobTitle.name}</>}
            {plan.employee.department && <> · {plan.employee.department.name}</>}
          </>
        }
        actions={
          <>
            {isPip && (
              <Badge tone="warning">
                <Lock aria-hidden className="mr-1 inline h-3 w-3" />
                Restricted
              </Badge>
            )}
            <Badge
              tone={
                plan.status === 'ACTIVE'
                  ? 'info'
                  : plan.status === 'COMPLETED'
                    ? 'success'
                    : 'neutral'
              }
            >
              {PLAN_STATUS_LABELS[plan.status as PlanStatus]}
            </Badge>
            {plan.canEdit && (
              <PlanStatusControls
                planId={plan.id}
                status={plan.status}
                outcome={plan.outcome}
                planType={plan.planType}
              />
            )}
          </>
        }
      />

      {isPip && (
        <Alert tone="warning" className="mb-5 max-w-4xl" title="This is a restricted record">
          A performance improvement plan is visible to {fullName(plan.employee)}, their direct manager
          and HR only — not the wider management chain, and not leadership. That restriction cannot be
          relaxed afterwards, because the plan was written on that understanding.
          {plan.isSubject && (
            <>
              {' '}
              You can record progress against each action and add check-ins, but the plan&rsquo;s terms
              are set by your manager — showing you have met it and rewriting what it asked for are
              different things.
            </>
          )}
        </Alert>
      )}

      {plan.status === 'DRAFT' && (
        <Alert tone="info" className="mb-5 max-w-4xl" title="Still a draft">
          {plan.isSubject
            ? 'This plan has not been activated yet, so nobody has been notified about it.'
            : `${fullName(plan.employee)} has not been notified. Activating the plan is what tells them it exists.`}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {plan.description && (
            <Card>
              <CardHeader title="What this is for" />
              <CardBody>
                <ProseText>{plan.description}</ProseText>
              </CardBody>
            </Card>
          )}

          <ActionList
            planId={plan.id}
            canEdit={plan.canEdit && !closed}
            canRecordProgress={plan.canRecordProgress && !closed}
            isSubject={plan.isSubject}
            actions={plan.actions.map((a) => ({
              id: a.id,
              title: a.title,
              description: a.description,
              itemType: a.itemType,
              status: a.status,
              dueDate: a.dueDate ? a.dueDate.toISOString().slice(0, 10) : null,
              dueLabel: a.dueDate ? relativeDueLabel(a.dueDate) : null,
              overdue:
                a.status !== 'COMPLETED' && a.status !== 'CANCELLED' && isOverdue(a.dueDate),
              ownerName: a.owner ? `${a.owner.firstName} ${a.owner.lastName}` : null,
              competencyName: a.competency?.name ?? null,
            }))}
          />

          <Card>
            <CardHeader
              title="Check-ins"
              description="The conversation record. Entries cannot be edited or removed once added — an append-only thread is what makes the history worth reading."
            />
            {plan.checkIns.length === 0 ? (
              <CardBody>
                <p className="text-sm text-slate-500">
                  No check-ins yet. The first one usually records what was agreed when the plan
                  started.
                </p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-slate-100">
                {plan.checkIns.map((c) => (
                  <li key={c.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link
                        href={`/people/${c.author.id}`}
                        className="text-sm font-medium text-slate-900 hover:underline"
                      >
                        {c.author.firstName} {c.author.lastName}
                      </Link>
                      <span className="text-xs text-slate-500" title={formatDate(c.createdAt)}>
                        {formatRelativeTime(c.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1">
                      <ProseText>{c.body}</ProseText>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {plan.canRecordProgress && !closed && (
              <CardBody className="border-t border-slate-100">
                <CheckInForm planId={plan.id} />
              </CardBody>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Progress" level={3} />
            <CardBody>
              {counted > 0 ? (
                <>
                  <ProgressBar
                    value={(done / counted) * 100}
                    label={`${done} of ${counted} complete`}
                    tone={done === counted ? 'success' : 'brand'}
                  />
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">
                    Counted out of {countLabel(counted, 'action')}
                    {cancelled > 0 && (
                      <>
                        ; {cancelled} cancelled {cancelled === 1 ? 'action is' : 'actions are'}{' '}
                        excluded from the denominator rather than counted as incomplete
                      </>
                    )}
                    . This figure is counted from the actions themselves, not reported separately, so
                    it cannot disagree with the list above.
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-500">No actions to measure yet.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Details" level={3} />
            <CardBody>
              <DetailList cols={1}>
                <DetailItem label="Type">
                  {PLAN_TYPE_LABELS[plan.planType as PlanType]}
                </DetailItem>
                <DetailItem label="Started">
                  {plan.startDate ? formatDate(plan.startDate) : 'Not set'}
                </DetailItem>
                <DetailItem label="Target">
                  {plan.targetDate ? (
                    <span
                      className={
                        isOverdue(plan.targetDate) && plan.status === 'ACTIVE'
                          ? 'font-medium text-rose-700'
                          : undefined
                      }
                    >
                      {formatDate(plan.targetDate)}
                      {plan.status === 'ACTIVE' && <> · {relativeDueLabel(plan.targetDate)}</>}
                    </span>
                  ) : (
                    'Not set'
                  )}
                </DetailItem>
                <DetailItem label="Visibility">
                  {isPip || plan.hrRestricted
                    ? 'Employee, direct manager, HR'
                    : 'Employee, management chain, HR'}
                </DetailItem>
                {plan.closedAt && (
                  <DetailItem label="Closed">{formatDate(plan.closedAt)}</DetailItem>
                )}
              </DetailList>
            </CardBody>
          </Card>

          {plan.outcome && (
            <Card>
              <CardHeader title="Outcome" level={3} />
              <CardBody>
                <ProseText>{plan.outcome}</ProseText>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
