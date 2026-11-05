import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Target,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { getInbox } from '@/server/services/inbox';
import {
  employeeDashboard,
  hrDashboard,
  leadershipGoalSummary,
  managerDashboard,
  type GoalSummary,
} from '@/server/services/dashboard';
import {
  Alert,
  Avatar,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  EmptyState,
  Grid,
  PageHeader,
  ProgressBar,
  StatTile,
} from '@/components/ui/primitives';
import { SegmentedBar } from '@/components/charts/bar-chart';
import { STATUS, STAGE_COLORS } from '@/components/charts/palette';
import {
  countLabel,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatScore,
  relativeDueLabel,
  truncate,
} from '@/lib/utils';
import {
  FEEDBACK_KIND_LABELS,
  GOAL_HEALTH_LABELS,
  PARTICIPANT_STATUS_LABELS,
  type FeedbackKind,
  type GoalHealth,
  type ParticipantStatus,
} from '@/lib/enums';

export const metadata = { title: 'Home' };

const RISK_TONE: Record<string, 'danger' | 'warning' | 'neutral'> = {
  OVERDUE: 'danger',
  BLOCKED: 'danger',
  OFF_TRACK: 'warning',
  AT_RISK: 'warning',
  DUE_SOON: 'neutral',
  NONE: 'neutral',
};

function GoalRow({ goal, showOwner }: { goal: GoalSummary; showOwner?: boolean }) {
  return (
    <li className="px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href={`/goals/${goal.id}`} className="text-sm font-medium text-slate-900 hover:underline">
            {goal.title}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            {showOwner && goal.ownerName && <span>{goal.ownerName}</span>}
            {showOwner && goal.ownerName && <span aria-hidden>·</span>}
            <span>{goal.dueDate ? relativeDueLabel(goal.dueDate) : 'No due date'}</span>
            {goal.risk !== 'NONE' && goal.risk !== 'DUE_SOON' && (
              <Badge tone={RISK_TONE[goal.risk] ?? 'neutral'}>
                {goal.risk === 'OVERDUE'
                  ? 'Past due'
                  : GOAL_HEALTH_LABELS[goal.health as GoalHealth] ?? goal.health}
              </Badge>
            )}
          </p>
        </div>
        <div className="w-28 flex-shrink-0 pt-0.5">
          <ProgressBar
            value={goal.displayPct}
            size="sm"
            tone={
              goal.risk === 'OVERDUE' || goal.risk === 'BLOCKED'
                ? 'danger'
                : goal.risk === 'AT_RISK' || goal.risk === 'OFF_TRACK'
                  ? 'warning'
                  : 'brand'
            }
            label={`${goal.title} progress`}
          />
          <p className="mt-1 text-right text-[11px] tabular-nums text-slate-500">
            {goal.displayPct === null
              ? 'Not recorded'
              : `${Math.round(goal.displayPct)}% ${goal.progressSource === 'COMPUTED' ? 'calculated' : 'reported'}`}
          </p>
        </div>
      </div>
    </li>
  );
}

export default async function HomePage() {
  const actor = await requireActor();
  const [inbox, employee, manager, hr, leadership] = await Promise.all([
    getInbox(actor),
    employeeDashboard(actor),
    managerDashboard(actor),
    hrDashboard(actor),
    leadershipGoalSummary(actor),
  ]);

  const firstName = actor.displayName.split(' ')[0] ?? 'there';
  const hasAnything =
    inbox.total > 0 ||
    (employee?.myGoals.length ?? 0) > 0 ||
    (manager?.teamSize ?? 0) > 0 ||
    (hr?.cycles.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title={`Good to see you, ${firstName}`}
        description={
          inbox.total === 0
            ? 'Nothing is waiting on you right now.'
            : `${countLabel(inbox.total, 'item')} waiting on you${inbox.overdueCount > 0 ? `, ${inbox.overdueCount} overdue` : ''}.`
        }
        actions={
          inbox.total > 0 ? (
            <ButtonLink href="/tasks" variant="primary">
              Go to my tasks
              <ArrowRight aria-hidden className="h-4 w-4" />
            </ButtonLink>
          ) : undefined
        }
      />

      {!hasAnything && (
        <Card className="mb-6">
          <EmptyState
            icon={<ClipboardList className="h-5 w-5" />}
            title="This organization has not started yet"
            description={
              actor.isHrAdmin ? (
                <>
                  Add your people, build a review template, then launch a cycle. Each step is a
                  separate screen and nothing is sent to anyone until you launch.
                </>
              ) : (
                <>
                  Once HR launches a review cycle or someone sets a goal, it will show up here. In
                  the meantime you can recognize a colleague or set yourself a goal.
                </>
              )
            }
            action={
              actor.isHrAdmin ? (
                <>
                  <ButtonLink href="/people/new" variant="primary">
                    Add an employee
                  </ButtonLink>
                  <ButtonLink href="/admin/templates">Review templates</ButtonLink>
                </>
              ) : (
                <>
                  <ButtonLink href="/goals/new" variant="primary">
                    Set a goal
                  </ButtonLink>
                  <ButtonLink href="/feedback/new">Give recognition</ButtonLink>
                </>
              )
            }
          />
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* HR / program administration                                       */}
      {/* ---------------------------------------------------------------- */}
      {hr && (
        <section className="mb-8" aria-labelledby="hr-heading">
          <h2 id="hr-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Performance program
          </h2>

          <Grid cols={4} className="mb-4">
            <StatTile
              label="Active cycles"
              value={hr.cycles.length}
              href="/reviews/cycles"
              denominator={`${hr.cycles.reduce((s, c) => s + c.participantCount, 0)} people taking part`}
            />
            <StatTile
              label="Waiting for approval"
              value={hr.pendingApprovals}
              tone={hr.pendingApprovals > 0 ? 'warning' : 'neutral'}
              href="/reviews/approvals"
            />
            <StatTile
              label="Overdue assignments"
              value={hr.cycles.reduce((s, c) => s + c.overdueAssignments, 0)}
              tone={hr.cycles.reduce((s, c) => s + c.overdueAssignments, 0) > 0 ? 'danger' : 'success'}
              href="/reports/review-completion"
            />
            <StatTile
              label="Needs attention"
              value={hr.exceptions.total}
              tone={hr.exceptions.total > 0 ? 'warning' : 'success'}
              href="/admin/exceptions"
              hint={hr.exceptions.total === 0 ? 'No administrative exceptions.' : undefined}
            />
          </Grid>

          {hr.exceptions.total > 0 && (
            <Alert
              tone="warning"
              className="mb-4"
              icon={<TriangleAlert className="h-4 w-4" />}
              title="Administrative exceptions"
            >
              <ul className="mt-1 space-y-0.5">
                {hr.exceptions.noManager > 0 && (
                  <li>
                    {countLabel(hr.exceptions.noManager, 'active employee')} with no manager, so no
                    manager review can be assigned.
                  </li>
                )}
                {hr.exceptions.noAccount > 0 && (
                  <li>
                    {countLabel(hr.exceptions.noAccount, 'active employee')} with no sign-in account.
                  </li>
                )}
                {hr.exceptions.deactivatedReviewer > 0 && (
                  <li>
                    {countLabel(hr.exceptions.deactivatedReviewer, 'open review')} assigned to a
                    deactivated account — reassign the reviewer.
                  </li>
                )}
                {hr.exceptions.approvedNotReleased > 0 && (
                  <li>
                    {countLabel(hr.exceptions.approvedNotReleased, 'review')} approved but not yet
                    released to the employee.
                  </li>
                )}
                {hr.exceptions.staleAcknowledgement > 0 && (
                  <li>
                    {countLabel(hr.exceptions.staleAcknowledgement, 'released review')} unacknowledged
                    for more than three weeks.
                  </li>
                )}
              </ul>
              <Link
                href="/admin/exceptions"
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium underline"
              >
                Work through these
                <ArrowRight aria-hidden className="h-3.5 w-3.5" />
              </Link>
            </Alert>
          )}

          <div className="space-y-4">
            {hr.cycles.map((c) => {
              const stageParts = (
                [
                  'NOT_STARTED',
                  'IN_PROGRESS',
                  'AWAITING_APPROVAL',
                  'APPROVED',
                  'RELEASED',
                  'ACKNOWLEDGED',
                ] as ParticipantStatus[]
              )
                .map((s) => ({
                  label: PARTICIPANT_STATUS_LABELS[s],
                  value: c.statusCounts[s] ?? 0,
                  color: STAGE_COLORS[s] ?? STATUS.warning,
                }))
                .filter((p) => p.value > 0);

              return (
                <Card key={c.id}>
                  <CardHeader
                    title={
                      <Link href={`/reviews/cycles/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    }
                    description={
                      <>
                        Self-assessments due {formatDate(c.selfDueAt)} · manager reviews due{' '}
                        {formatDate(c.managerDueAt)}
                      </>
                    }
                    actions={
                      <>
                        {c.overdueAssignments > 0 && (
                          <Badge tone="danger">{c.overdueAssignments} overdue</Badge>
                        )}
                        <ButtonLink href={`/reviews/cycles/${c.id}`} size="sm">
                          Manage
                        </ButtonLink>
                      </>
                    }
                  />
                  <CardBody>
                    <Grid cols={3} className="mb-5">
                      <StatTile
                        label="Self-assessments submitted"
                        value={c.selfTotal === 0 ? '—' : `${c.selfSubmitted}`}
                        denominator={
                          c.selfTotal === 0
                            ? 'Self-assessments are not part of this cycle'
                            : `of ${c.selfTotal} assigned · ${Math.round((c.selfSubmitted / c.selfTotal) * 100)}%`
                        }
                      />
                      <StatTile
                        label="Manager reviews submitted"
                        value={c.managerTotal === 0 ? '—' : `${c.managerSubmitted}`}
                        denominator={
                          c.managerTotal === 0
                            ? 'No manager reviews assigned'
                            : `of ${c.managerTotal} assigned · ${Math.round((c.managerSubmitted / c.managerTotal) * 100)}%`
                        }
                      />
                      <StatTile
                        label="Results released"
                        value={c.releasedCount}
                        denominator={`of ${c.participantCount} people in the cycle`}
                      />
                    </Grid>

                    {stageParts.length > 0 && (
                      <SegmentedBar
                        title="Where each person's review has got to"
                        subtitle="One block per stage, sized by how many people are at it."
                        parts={stageParts}
                        totalLabel={`${c.participantCount} people in this cycle`}
                        footnote={
                          <>
                            Counted from participant records at page load. A person sits at exactly
                            one stage.{' '}
                            {c.requireApproval
                              ? 'This cycle requires approval before results can be released.'
                              : 'This cycle does not require approval before release.'}
                          </>
                        }
                      />
                    )}
                  </CardBody>
                </Card>
              );
            })}

            {hr.cycles.length === 0 && (
              <Card>
                <EmptyState
                  icon={<ClipboardList className="h-5 w-5" />}
                  title="No cycle is running"
                  description="Create a cycle, pick who is in it and which template to use, then launch it. Nothing reaches a reviewer until you launch."
                  action={<ButtonLink href="/reviews/cycles/new" variant="primary">Create a review cycle</ButtonLink>}
                />
              </Card>
            )}
          </div>

          {hr.openSurveys.length > 0 && (
            <Card className="mt-4">
              <CardHeader title="Open surveys" />
              <ul className="divide-y divide-slate-100">
                {hr.openSurveys.map((s) => {
                  const responses = s._count.responses;
                  const invited = s._count.invitations;
                  const belowThreshold = responses < s.minResponsesForResults;
                  return (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <Link href={`/surveys/${s.id}`} className="text-sm font-medium text-slate-900 hover:underline">
                          {s.title}
                        </Link>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {s.mode === 'ANONYMOUS' ? 'Anonymous' : 'Named'} · closes{' '}
                          {formatDate(s.closesAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs tabular-nums text-slate-600">
                          {responses} of {invited} responded
                        </span>
                        {belowThreshold && (
                          <Badge tone="neutral" title={`Results stay hidden until ${s.minResponsesForResults} people respond.`}>
                            Results hidden
                          </Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Manager                                                           */}
      {/* ---------------------------------------------------------------- */}
      {manager && (
        <section className="mb-8" aria-labelledby="team-heading">
          <h2 id="team-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            My team
          </h2>

          <Grid cols={4} className="mb-4">
            <StatTile
              label="People in my reporting line"
              value={manager.teamSize}
              denominator={`${manager.directReportCount} direct`}
              href="/people?scope=team"
            />
            <StatTile
              label="Reviews I still owe"
              value={manager.myOutstandingReviews.length}
              tone={manager.myOverdueReviews.length > 0 ? 'danger' : manager.myOutstandingReviews.length > 0 ? 'warning' : 'success'}
              hint={
                manager.myOverdueReviews.length > 0
                  ? `${manager.myOverdueReviews.length} past the due date`
                  : undefined
              }
              href="/tasks"
            />
            <StatTile
              label="Team goals needing attention"
              value={manager.goalsAtRisk.length}
              tone={manager.goalsAtRisk.length > 0 ? 'warning' : 'success'}
              denominator={`of ${manager.teamGoals.length} active team goals`}
              href="/goals?scope=team"
            />
            <StatTile
              label="Overdue action items"
              value={manager.overdueActions}
              tone={manager.overdueActions > 0 ? 'warning' : 'success'}
              href="/meetings/actions"
            />
          </Grid>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Where my team's reviews have got to"
                description="Only people in my reporting line. Draft answers are not visible to me until they are submitted."
              />
              {manager.teamParticipants.length === 0 ? (
                <EmptyState
                  title="No one on my team is in an active cycle"
                  description="When HR launches a cycle that includes your team, their progress appears here."
                />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {manager.teamParticipants.slice(0, 8).map((p) => {
                    const self = p.assignments.find((a) => a.kind === 'SELF');
                    const mgr = p.assignments.find((a) => a.kind === 'MANAGER');
                    return (
                      <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                        <Avatar firstName={p.employee.firstName} lastName={p.employee.lastName} size="sm" />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/reviews/participants/${p.id}`}
                            className="truncate text-sm font-medium text-slate-900 hover:underline"
                          >
                            {p.employee.preferredName || p.employee.firstName} {p.employee.lastName}
                          </Link>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                            <span>
                              Self:{' '}
                              {self?.status === 'SUBMITTED'
                                ? 'submitted'
                                : self?.status === 'DRAFT'
                                  ? 'in progress'
                                  : 'not started'}
                            </span>
                            <span aria-hidden>·</span>
                            <span>
                              Mine:{' '}
                              {mgr?.status === 'SUBMITTED'
                                ? 'submitted'
                                : mgr?.status === 'DRAFT'
                                  ? 'in progress'
                                  : 'not started'}
                            </span>
                          </p>
                        </div>
                        <Badge
                          tone={
                            p.status === 'RELEASED' || p.status === 'ACKNOWLEDGED'
                              ? 'success'
                              : p.status === 'AWAITING_APPROVAL'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {PARTICIPANT_STATUS_LABELS[p.status as ParticipantStatus] ?? p.status}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
              {manager.teamParticipants.length > 8 && (
                <CardFooter>
                  <Link href="/reviews" className="text-sm font-medium text-brand-700 hover:underline">
                    See all {manager.teamParticipants.length}
                  </Link>
                </CardFooter>
              )}
            </Card>

            <Card>
              <CardHeader
                title="One-to-ones"
                description="When each direct report was last met. A long gap is usually the first thing to fix."
              />
              <ul className="divide-y divide-slate-100">
                {manager.directReports.map((r) => {
                  const days = r.lastMeetingAt
                    ? Math.round((Date.now() - r.lastMeetingAt.getTime()) / 86_400_000)
                    : null;
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                      <Avatar firstName={r.firstName} lastName={r.lastName} size="sm" />
                      <div className="min-w-0 flex-1">
                        <Link href={`/people/${r.id}`} className="truncate text-sm font-medium text-slate-900 hover:underline">
                          {r.name}
                        </Link>
                        {r.jobTitle && <p className="truncate text-xs text-slate-500">{r.jobTitle}</p>}
                      </div>
                      {days === null ? (
                        <Badge tone="warning">Never met</Badge>
                      ) : days > 45 ? (
                        <Badge tone="warning">{days} days ago</Badge>
                      ) : (
                        <span className="text-xs text-slate-500">{days} days ago</span>
                      )}
                    </li>
                  );
                })}
                {manager.directReports.length === 0 && (
                  <li className="px-5 py-8 text-center text-sm text-slate-500">
                    No active direct reports.
                  </li>
                )}
              </ul>
              <CardFooter>
                <Link href="/meetings" className="text-sm font-medium text-brand-700 hover:underline">
                  Go to meetings
                </Link>
              </CardFooter>
            </Card>
          </div>

          {manager.goalsAtRisk.length > 0 && (
            <Card className="mt-4">
              <CardHeader
                title="Team goals needing attention"
                description="Overdue, blocked, at risk or off track."
                actions={<Badge tone="warning">{manager.goalsAtRisk.length}</Badge>}
              />
              <ul className="divide-y divide-slate-100">
                {manager.goalsAtRisk.slice(0, 6).map((g) => (
                  <GoalRow key={g.id} goal={g} showOwner />
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Leadership goal roll-up                                          */}
      {/* ---------------------------------------------------------------- */}
      {leadership && leadership.companyGoals.length > 0 && (
        <section className="mb-8" aria-labelledby="company-heading">
          <h2
            id="company-heading"
            className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500"
          >
            Company goals
          </h2>
          <Card>
            <ul className="divide-y divide-slate-100">
              {leadership.companyGoals.map((g) => (
                <GoalRow key={g.id} goal={g} />
              ))}
            </ul>
            <CardFooter>
              <Link href="/goals?scope=company" className="text-sm font-medium text-brand-700 hover:underline">
                All company and team goals
              </Link>
            </CardFooter>
          </Card>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Everyone                                                          */}
      {/* ---------------------------------------------------------------- */}
      {employee && (
        <section aria-labelledby="mine-heading">
          <h2 id="mine-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Mine
          </h2>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="My goals"
                description="Active goals I own."
                actions={<ButtonLink href="/goals/new" size="sm">Add a goal</ButtonLink>}
              />
              {employee.myGoals.length === 0 ? (
                <EmptyState
                  icon={<Target className="h-5 w-5" />}
                  title="No active goals"
                  description="A goal gives a review something concrete to talk about. Two or three is usually plenty."
                  action={<ButtonLink href="/goals/new" variant="primary">Set your first goal</ButtonLink>}
                />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {employee.myGoals.map((g) => (
                    <GoalRow key={g.id} goal={g} />
                  ))}
                </ul>
              )}
            </Card>

            <div className="space-y-4">
              {employee.latestResult && (
                <Card>
                  <CardHeader title="My latest review" level={3} />
                  <CardBody>
                    <p className="text-sm font-medium text-slate-900">
                      {employee.latestResult.cycle.name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDate(employee.latestResult.cycle.periodStart)} —{' '}
                      {formatDate(employee.latestResult.cycle.periodEnd)}
                    </p>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-600">Overall score</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">
                          {formatScore(
                            employee.latestResult.calibratedScore ?? employee.latestResult.finalScore,
                          )}
                          {employee.latestResult.finalScore !== null && ' / 100'}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-600">Released</dt>
                        <dd className="text-slate-900">{formatDate(employee.latestResult.releasedAt)}</dd>
                      </div>
                    </dl>
                    {employee.latestResult.status === 'RELEASED' ? (
                      <Alert tone="warning" className="mt-3">
                        You have not acknowledged this yet. Acknowledging records that you received
                        it — it does not mean you agree with it.
                      </Alert>
                    ) : (
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
                        <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
                        Acknowledged {formatDate(employee.latestResult.acknowledgedAt)}
                      </p>
                    )}
                  </CardBody>
                  <CardFooter>
                    <ButtonLink href={`/reviews/results/${employee.latestResult.id}`} size="sm" variant="primary">
                      Read it
                    </ButtonLink>
                  </CardFooter>
                </Card>
              )}

              <Card>
                <CardHeader title="Next one-to-ones" level={3} />
                {employee.upcomingMeetings.length === 0 ? (
                  <EmptyState
                    icon={<CalendarDays className="h-5 w-5" />}
                    title="Nothing scheduled"
                    description="Set up a recurring one-to-one so agenda items and action items carry over between meetings."
                    action={<ButtonLink href="/meetings/new" size="sm">Schedule one</ButtonLink>}
                  />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {employee.upcomingMeetings.map((m) => (
                      <li key={m.id} className="px-5 py-3">
                        <Link href={`/meetings/${m.id}`} className="text-sm font-medium text-slate-900 hover:underline">
                          {m.title}
                        </Link>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                          <Clock aria-hidden className="h-3 w-3" />
                          {formatDateTime(m.scheduledAt)}
                          {m.location && ` · ${m.location}`}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {m._count.agendaItems === 0
                            ? 'No agenda items yet'
                            : countLabel(m._count.agendaItems, 'agenda item')}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader title="Recent feedback about me" level={3} />
                {employee.recentFeedback.length === 0 ? (
                  <EmptyState
                    title="No feedback yet"
                    description="Feedback people share with you appears here. You can also ask for it."
                    action={<ButtonLink href="/feedback/request" size="sm">Ask for feedback</ButtonLink>}
                  />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {employee.recentFeedback.map((f) => (
                      <li key={f.id} className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Badge
                            tone={f.kind === 'RECOGNITION' ? 'accent' : 'neutral'}
                          >
                            {f.recognitionValue?.name ??
                              FEEDBACK_KIND_LABELS[f.kind as FeedbackKind] ??
                              f.kind}
                          </Badge>
                          <span className="text-xs text-slate-500">
                            {f.authorVisibility === 'NAMED' && f.author
                              ? `${f.author.preferredName || f.author.firstName} ${f.author.lastName}`
                              : f.authorVisibility === 'ANONYMOUS'
                                ? 'Anonymous'
                                : 'Name withheld'}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                          {truncate(f.body, 190)}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {formatRelativeTime(f.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <CardFooter>
                  <Link href="/feedback" className="text-sm font-medium text-brand-700 hover:underline">
                    All feedback
                  </Link>
                </CardFooter>
              </Card>

              {employee.openActions > 0 && (
                <Card>
                  <CardBody>
                    <p className="flex items-start gap-2 text-sm text-slate-700">
                      <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                      <span>
                        You own {countLabel(employee.openActions, 'open action item')} from your
                        one-to-ones.
                      </span>
                    </p>
                    <ButtonLink href="/meetings/actions" size="sm" className="mt-3">
                      <Users aria-hidden className="h-3.5 w-3.5" />
                      See them
                    </ButtonLink>
                  </CardBody>
                </Card>
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
