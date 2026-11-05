import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Calculator, CheckCircle2, Circle, Eye, Link2, Pencil } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { getGoal } from '@/server/services/goals';
import { isAppError } from '@/server/errors';
import {
  Alert,
  Avatar,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DetailItem,
  DetailList,
  PageHeader,
  ProgressBar,
  ProseText,
} from '@/components/ui/primitives';
import { GoalProgressPanel, GoalComments } from './panels';
import { formatDate, formatRelativeTime, fullName, relativeDueLabel } from '@/lib/utils';
import {
  GOAL_HEALTH_LABELS,
  GOAL_SCOPE_LABELS,
  GOAL_STATUS_LABELS,
  GOAL_VISIBILITY_LABELS,
  MEASUREMENT_TYPE_LABELS,
  type GoalHealth,
  type GoalScope,
  type GoalStatus,
  type GoalVisibility,
  type MeasurementType,
} from '@/lib/enums';

export const metadata = { title: 'Goal' };

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;

  let data: Awaited<ReturnType<typeof getGoal>>;
  try {
    data = await getGoal(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }

  const { goal, raw, canEdit, canUpdateProgress, canComment } = data;
  const progress = goal.progress;

  const tone =
    goal.risk === 'OVERDUE' || goal.risk === 'BLOCKED'
      ? 'danger'
      : goal.risk === 'AT_RISK' || goal.risk === 'OFF_TRACK'
        ? 'warning'
        : goal.status === 'COMPLETED'
          ? 'success'
          : 'brand';

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Goals', href: '/goals' }, { label: goal.title }]}
        title={goal.title}
        description={goal.outcome ?? goal.description ?? undefined}
        meta={
          <>
            <Badge tone={goal.scope === 'COMPANY' ? 'brand' : goal.scope === 'TEAM' ? 'info' : 'neutral'}>
              {GOAL_SCOPE_LABELS[goal.scope as GoalScope]}
            </Badge>
            <Badge tone={goal.status === 'COMPLETED' ? 'success' : 'neutral'}>
              {GOAL_STATUS_LABELS[goal.status as GoalStatus]}
            </Badge>
            {goal.status !== 'COMPLETED' && goal.status !== 'CANCELLED' && (
              <Badge
                tone={
                  goal.health === 'ON_TRACK'
                    ? 'success'
                    : goal.health === 'AT_RISK'
                      ? 'warning'
                      : 'danger'
                }
              >
                {GOAL_HEALTH_LABELS[goal.health as GoalHealth]}
              </Badge>
            )}
            {goal.category && <Badge tone="neutral">{goal.category}</Badge>}
          </>
        }
        actions={
          canEdit ? (
            <ButtonLink href={`/goals/${id}/edit`}>
              <Pencil aria-hidden className="h-4 w-4" />
              Edit
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-5">
          {/* ------------------------------------------------- progress */}
          <Card>
            <CardHeader
              title="Progress"
              description={MEASUREMENT_TYPE_LABELS[goal.measurementType as MeasurementType]}
            />
            <CardBody className="space-y-4">
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-3xl font-semibold tabular-nums text-slate-900">
                    {progress.displayPct === null ? '—' : `${Math.round(progress.displayPct)}%`}
                  </p>
                  <p className="text-xs text-slate-500">
                    {progress.source === 'COMPUTED'
                      ? 'calculated from the measurements below'
                      : progress.source === 'REPORTED'
                        ? 'reported by the goal owner'
                        : 'no progress recorded'}
                  </p>
                </div>
                <ProgressBar value={progress.displayPct} tone={tone} label={goal.title} className="mt-2" />
              </div>

              <Alert tone="neutral" icon={<Calculator className="h-4 w-4" />}>
                <p className="font-medium">How this figure is worked out</p>
                <p className="mt-1 leading-relaxed">{progress.explanation}</p>
              </Alert>

              {progress.divergent && (
                <Alert tone="warning" title="Reported and calculated progress disagree">
                  The owner reports {Math.round(progress.reportedPct as number)}%, while the
                  measurements give {Math.round(progress.computedPct as number)}%. The calculated
                  figure is the one shown above. Both are kept — neither overwrites the other.
                </Alert>
              )}

              {goal.measurementType === 'NUMERIC' && (
                <DetailList cols={4}>
                  <DetailItem label="Start">
                    {goal.startValue ?? '—'}
                    {goal.unit ? ` ${goal.unit}` : ''}
                  </DetailItem>
                  <DetailItem label="Current">
                    <span className="font-semibold">{goal.currentValue ?? '—'}</span>
                    {goal.unit ? ` ${goal.unit}` : ''}
                  </DetailItem>
                  <DetailItem label="Target">
                    {goal.targetValue ?? '—'}
                    {goal.unit ? ` ${goal.unit}` : ''}
                  </DetailItem>
                  <DetailItem label="Direction">
                    {goal.higherIsBetter ? 'Higher is better' : 'Lower is better'}
                  </DetailItem>
                </DetailList>
              )}

              {goal.milestones.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-800">
                    Milestones ({goal.milestones.filter((m) => m.completedAt).length} of{' '}
                    {goal.milestones.length} complete)
                  </h4>
                  <ul className="space-y-1.5">
                    {goal.milestones.map((m) => (
                      <li key={m.id} className="flex items-start gap-2 text-sm">
                        {m.completedAt ? (
                          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                        ) : (
                          <Circle aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-300" />
                        )}
                        <span className={m.completedAt ? 'text-slate-500 line-through' : 'text-slate-800'}>
                          {m.title}
                          {m.dueDate && (
                            <span className="ml-2 text-xs text-slate-400">{formatDate(m.dueDate)}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>

          {canUpdateProgress && goal.status !== 'CANCELLED' && (
            <GoalProgressPanel
              goalId={id}
              measurementType={goal.measurementType}
              unit={goal.unit}
              currentValue={goal.currentValue}
              reportedProgressPct={progress.reportedPct}
              status={goal.status}
              health={goal.health}
              milestones={goal.milestones.map((m) => ({
                id: m.id,
                title: m.title,
                done: m.completedAt !== null,
              }))}
            />
          )}

          {/* --------------------------------------------------- history */}
          <Card>
            <CardHeader
              title="Progress history"
              description="Appended, never overwritten. Each entry keeps both the reported and the calculated figure as they stood that day."
            />
            {raw.updates.length === 0 ? (
              <CardBody>
                <p className="text-sm text-slate-500">No updates recorded yet.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-slate-100">
                {raw.updates.map((u) => (
                  <li key={u.id} className="flex gap-3 px-5 py-3.5">
                    <Avatar firstName={u.author.firstName} lastName={u.author.lastName} size="xs" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="font-medium text-slate-900">{fullName(u.author)}</span>
                        <span className="text-xs text-slate-500">{formatRelativeTime(u.createdAt)}</span>
                      </p>
                      {u.body && <ProseText className="mt-1">{u.body}</ProseText>}
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                        {u.reportedProgressPct !== null && (
                          <span>Reported {Math.round(u.reportedProgressPct)}%</span>
                        )}
                        {u.computedProgressPct !== null && (
                          <span>Calculated {Math.round(u.computedProgressPct)}%</span>
                        )}
                        {u.valueAtUpdate !== null && (
                          <span>
                            Value {u.valueAtUpdate}
                            {goal.unit ? ` ${goal.unit}` : ''}
                          </span>
                        )}
                        {u.healthAtUpdate && (
                          <span>{GOAL_HEALTH_LABELS[u.healthAtUpdate as GoalHealth] ?? u.healthAtUpdate}</span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <GoalComments
            goalId={id}
            canComment={canComment}
            comments={raw.comments.map((c) => ({
              id: c.id,
              body: c.body,
              createdAt: c.createdAt.toISOString(),
              authorName: fullName(c.author),
              authorFirstName: c.author.firstName,
              authorLastName: c.author.lastName,
            }))}
          />
        </div>

        {/* ----------------------------------------------------- sidebar */}
        <aside className="space-y-5">
          <Card>
            <CardHeader title="Details" level={3} />
            <CardBody>
              <DetailList cols={1}>
                <DetailItem label="Owner">
                  {raw.owner ? (
                    <Link href={`/people/${raw.owner.id}`} className="inline-flex items-center gap-2 hover:underline">
                      <Avatar firstName={raw.owner.firstName} lastName={raw.owner.lastName} size="xs" />
                      {fullName(raw.owner)}
                    </Link>
                  ) : (
                    'Unassigned'
                  )}
                </DetailItem>
                {raw.department && <DetailItem label="Department">{raw.department.name}</DetailItem>}
                <DetailItem label="Dates">
                  {goal.startDate ? formatDate(goal.startDate) : 'No start date'} —{' '}
                  {goal.dueDate ? formatDate(goal.dueDate) : 'no due date'}
                  {goal.dueDate && goal.status !== 'COMPLETED' && (
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {relativeDueLabel(goal.dueDate)}
                    </span>
                  )}
                </DetailItem>
                <DetailItem label="Who can see this">
                  <span className="flex items-start gap-1.5">
                    <Eye aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                    <span className="text-xs leading-relaxed">
                      {GOAL_VISIBILITY_LABELS[goal.visibility as GoalVisibility] ?? goal.visibility}
                    </span>
                  </span>
                </DetailItem>
                {raw.collaborators.length > 0 && (
                  <DetailItem label="Collaborators">
                    <ul className="space-y-1">
                      {raw.collaborators.map((c) => (
                        <li key={c.id}>
                          <Link href={`/people/${c.employee.id}`} className="text-sm hover:underline">
                            {fullName(c.employee)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </DetailItem>
                )}
              </DetailList>
            </CardBody>
          </Card>

          {goal.description && (
            <Card>
              <CardHeader title="Description" level={3} />
              <CardBody>
                <ProseText>{goal.description}</ProseText>
                {goal.outcome && (
                  <>
                    <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                      Intended outcome
                    </p>
                    <ProseText className="mt-1">{goal.outcome}</ProseText>
                  </>
                )}
              </CardBody>
            </Card>
          )}

          {(raw.parentGoal || raw.childGoals.length > 0) && (
            <Card>
              <CardHeader title="Alignment" level={3} />
              <CardBody className="space-y-3">
                {raw.parentGoal && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Supports</p>
                    <Link
                      href={`/goals/${raw.parentGoal.id}`}
                      className="mt-1 flex items-start gap-1.5 text-sm text-brand-700 hover:underline"
                    >
                      <Link2 aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      {raw.parentGoal.title}
                    </Link>
                  </div>
                )}
                {raw.childGoals.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Supported by ({raw.childGoals.length})
                    </p>
                    <ul className="mt-1 space-y-1.5">
                      {raw.childGoals.map((c) => (
                        <li key={c.id}>
                          <Link href={`/goals/${c.id}`} className="text-sm text-slate-800 hover:underline">
                            {c.title}
                          </Link>
                          {c.owner && (
                            <span className="block text-xs text-slate-500">{fullName(c.owner)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
