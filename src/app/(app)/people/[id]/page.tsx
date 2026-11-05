import Link from 'next/link';
import { notFound } from 'next/navigation';
import { History, Lock, Mail, Phone, ShieldCheck } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { getEmployeeProfile } from '@/server/services/people';
import { listVisibleParticipants } from '@/server/services/review-lists';
import { listGoals } from '@/server/services/goals';
import { listFeedback } from '@/server/services/feedback';
import { listActionItems } from '@/server/services/meetings';
import { prisma } from '@/server/db';
import { canViewPlan } from '@/server/authz/policy';
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
  EmptyState,
  LinkTabs,
  PageHeader,
  ProgressBar,
  ProseText,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { EmployeeAdminControls } from './controls';
import { formatDate, formatRelativeTime, formatScore, fullName, truncate } from '@/lib/utils';
import {
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  FEEDBACK_KIND_LABELS,
  GOAL_STATUS_LABELS,
  PARTICIPANT_STATUS_LABELS,
  PLAN_TYPE_LABELS,
  type EmploymentStatus,
  type EmploymentType,
  type FeedbackKind,
  type GoalStatus,
  type ParticipantStatus,
  type PlanType,
} from '@/lib/enums';

export const metadata = { title: 'Employee' };

type Tab = 'overview' | 'reviews' | 'goals' | 'feedback' | 'development' | 'history';

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await requireActor();
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  let data: Awaited<ReturnType<typeof getEmployeeProfile>>;
  try {
    data = await getEmployeeProfile(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }

  const { employee, canSeeRecord, isSelf } = data;
  const name = fullName(employee);

  // Only load the record tabs for someone allowed to see them.
  const [participants, goals, feedback, actions, plans] = canSeeRecord
    ? await Promise.all([
        listVisibleParticipants(actor, { employeeId: id, includeClosed: true }),
        listGoals(actor, { ownerEmployeeId: id }),
        listFeedback(actor, { aboutEmployeeId: id, limit: 40 }),
        listActionItems(actor, { scope: 'team' }),
        prisma.developmentPlan.findMany({
          where: { employeeId: id, orgId: actor.orgId },
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { actions: true } }, actions: { select: { status: true } } },
        }),
      ])
    : [[], [], [], [], []];

  const visiblePlans = plans.filter((p) =>
    canViewPlan(actor, {
      employeeId: id,
      planType: p.planType,
      hrRestricted: p.hrRestricted,
      employeeManagerChainIds: actor.employeeId ? [...actor.managerChainIds, employee.managerId ?? ''] : [],
    }),
  );

  const theirActions = actions.filter((a) => a.ownerEmployeeId === id);

  const tabs: { key: Tab; label: string; href: string; count?: number }[] = [
    { key: 'overview', label: 'Overview', href: `/people/${id}` },
  ];
  if (canSeeRecord) {
    tabs.push(
      { key: 'reviews', label: 'Reviews', href: `/people/${id}?tab=reviews`, count: participants.length },
      { key: 'goals', label: 'Goals', href: `/people/${id}?tab=goals`, count: goals.length },
      { key: 'feedback', label: 'Feedback', href: `/people/${id}?tab=feedback`, count: feedback.length },
      {
        key: 'development',
        label: 'Development',
        href: `/people/${id}?tab=development`,
        count: visiblePlans.length,
      },
    );
  }
  if (actor.isHrAdmin) {
    tabs.push({ key: 'history', label: 'Reporting history', href: `/people/${id}?tab=history` });
  }

  const requested = (sp.tab as Tab) ?? 'overview';
  const current: Tab = tabs.some((t) => t.key === requested) ? requested : 'overview';

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'People', href: '/people' }, { label: name }]}
        title={name}
        description={
          <>
            {employee.jobTitle?.name ?? 'No job title set'}
            {employee.department ? ` · ${employee.department.name}` : ''}
            {employee.crew ? ` · ${employee.crew}` : ''}
          </>
        }
        meta={
          <>
            {employee.employmentStatus !== 'active' && (
              <Badge tone={employee.employmentStatus === 'terminated' ? 'danger' : 'warning'}>
                {EMPLOYMENT_STATUS_LABELS[employee.employmentStatus as EmploymentStatus]}
              </Badge>
            )}
            {employee.employmentType !== 'full_time' && (
              <Badge tone="neutral">
                {EMPLOYMENT_TYPE_LABELS[employee.employmentType as EmploymentType]}
              </Badge>
            )}
            {isSelf && <Badge tone="brand">This is you</Badge>}
            {!employee.user && actor.isHrAdmin && <Badge tone="warning">No sign-in account</Badge>}
          </>
        }
        actions={
          <EmployeeAdminControls
            employeeId={employee.id}
            employeeName={name}
            canEdit={data.canEdit}
            canChangeManager={data.canChangeManager}
            canDeactivate={data.canDeactivate}
            isDeactivated={employee.employmentStatus === 'terminated'}
            isHrAdmin={actor.isHrAdmin}
            currentManagerId={employee.managerId}
          />
        }
      />

      {!canSeeRecord && (
        <Alert tone="neutral" className="mb-5" icon={<Lock className="h-4 w-4" />} title="Directory view">
          You can see {name}&rsquo;s role, department and reporting line, which is what a company org
          chart would show. Their reviews, goals, feedback and development plans are not available to
          you.
        </Alert>
      )}

      <LinkTabs tabs={tabs} current={current} className="mb-5" />

      {/* ------------------------------------------------------- overview */}
      {current === 'overview' && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Details" />
            <CardBody>
              <DetailList cols={2}>
                <DetailItem label="Work e-mail">
                  <a href={`mailto:${employee.workEmail}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <Mail aria-hidden className="h-3.5 w-3.5 text-slate-400" />
                    {employee.workEmail}
                  </a>
                </DetailItem>
                {employee.workPhone && (
                  <DetailItem label="Work phone">
                    <span className="inline-flex items-center gap-1.5">
                      <Phone aria-hidden className="h-3.5 w-3.5 text-slate-400" />
                      {employee.workPhone}
                    </span>
                  </DetailItem>
                )}
                <DetailItem label="Job title">{employee.jobTitle?.name ?? '—'}</DetailItem>
                <DetailItem label="Department">{employee.department?.name ?? '—'}</DetailItem>
                <DetailItem label="Manager">
                  {employee.manager ? (
                    <Link href={`/people/${employee.manager.id}`} className="hover:underline">
                      {fullName(employee.manager)}
                    </Link>
                  ) : (
                    <span className="text-slate-400">None</span>
                  )}
                </DetailItem>
                <DetailItem label="Hired">{formatDate(employee.hireDate)}</DetailItem>
                <DetailItem label="Employment">
                  {EMPLOYMENT_TYPE_LABELS[employee.employmentType as EmploymentType]} ·{' '}
                  {EMPLOYMENT_STATUS_LABELS[employee.employmentStatus as EmploymentStatus]}
                </DetailItem>
                {employee.workLocation && (
                  <DetailItem label="Location">{employee.workLocation}</DetailItem>
                )}
                {employee.crew && <DetailItem label="Crew">{employee.crew}</DetailItem>}
                {employee.employeeNumber && (
                  <DetailItem label="Employee number">{employee.employeeNumber}</DetailItem>
                )}
                {employee.terminationDate && (
                  <DetailItem label="Deactivated">{formatDate(employee.terminationDate)}</DetailItem>
                )}
                {actor.isHrAdmin && (
                  <DetailItem label="Last signed in">
                    {employee.user?.lastLoginAt
                      ? formatRelativeTime(employee.user.lastLoginAt)
                      : 'Never'}
                  </DetailItem>
                )}
              </DetailList>
            </CardBody>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Direct reports" level={3} />
              {employee.directReports.length === 0 ? (
                <CardBody>
                  <p className="text-sm text-slate-500">No direct reports.</p>
                </CardBody>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {employee.directReports.map((r) => (
                    <li key={r.id} className="flex items-center gap-2.5 px-5 py-2.5">
                      <Avatar firstName={r.firstName} lastName={r.lastName} size="xs" />
                      <span className="min-w-0">
                        <Link
                          href={`/people/${r.id}`}
                          className="block truncate text-sm font-medium text-slate-900 hover:underline"
                        >
                          {fullName(r)}
                        </Link>
                        {r.jobTitle && (
                          <span className="block truncate text-xs text-slate-500">{r.jobTitle.name}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {employee.jobTitle?.competencyLibrary && (
              <Card>
                <CardHeader
                  title="Expected competencies"
                  description={`From the "${employee.jobTitle.competencyLibrary.name}" library, attached to this job title.`}
                  level={3}
                />
                <ul className="divide-y divide-slate-100">
                  {employee.jobTitle.competencyLibrary.items.map((item) => (
                    <li key={item.id} className="px-5 py-2.5">
                      <p className="text-sm font-medium text-slate-900">{item.competency.name}</p>
                      {item.competency.description && (
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                          {item.competency.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------- reviews */}
      {current === 'reviews' && canSeeRecord && (
        <Card>
          <CardHeader
            title="Review history"
            description="Every cycle this person has taken part in that you are permitted to see. The manager of record is the manager at the time, not necessarily today's."
          />
          {participants.length === 0 ? (
            <EmptyState title="No reviews yet" description="This person has not been in a review cycle." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Cycle</Th>
                  <Th>Manager of record</Th>
                  <Th>Stage</Th>
                  <Th>Released</Th>
                  <Th align="right">Score</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {participants.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-900">{p.cycleName}</Td>
                    <Td className="text-slate-600">{p.managerNameSnapshot ?? '—'}</Td>
                    <Td>
                      <Badge
                        tone={
                          p.status === 'ACKNOWLEDGED' || p.status === 'CLOSED'
                            ? 'success'
                            : p.status === 'RELEASED'
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {PARTICIPANT_STATUS_LABELS[p.status as ParticipantStatus] ?? p.status}
                      </Badge>
                    </Td>
                    <Td className="text-slate-600">{formatDate(p.releasedAt)}</Td>
                    <Td align="right" className="tabular-nums">
                      {formatScore(p.calibratedScore ?? p.finalScore)}
                    </Td>
                    <Td align="right">
                      <Link
                        href={`/reviews/participants/${p.id}`}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        Open
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}

      {/* ---------------------------------------------------------- goals */}
      {current === 'goals' && canSeeRecord && (
        <Card>
          <CardHeader
            title="Goals"
            description="Goals this person owns that you are permitted to see. A private goal is not listed."
          />
          {goals.length === 0 ? (
            <EmptyState title="No goals" description="Nothing you can see." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {goals.map((g) => (
                <li key={g.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <Link href={`/goals/${g.id}`} className="font-medium text-slate-900 hover:underline">
                        {g.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {GOAL_STATUS_LABELS[g.status as GoalStatus]}
                        {g.dueDate && ` · due ${formatDate(g.dueDate)}`}
                        {g.category && ` · ${g.category}`}
                      </p>
                    </div>
                    <div className="w-32 flex-shrink-0">
                      <ProgressBar value={g.progress.displayPct} size="sm" label={g.title} />
                      <p className="mt-1 text-right text-[11px] tabular-nums text-slate-500">
                        {g.progress.displayPct === null
                          ? 'Not recorded'
                          : `${Math.round(g.progress.displayPct)}% ${g.progress.source === 'COMPUTED' ? 'calculated' : 'reported'}`}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ------------------------------------------------------- feedback */}
      {current === 'feedback' && canSeeRecord && (
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Feedback"
              description="Feedback about this person that you are permitted to see. Private notes written by other people never appear here."
              actions={<ButtonLink href={`/feedback/new?about=${id}`} size="sm">Give feedback</ButtonLink>}
            />
            {feedback.length === 0 ? (
              <EmptyState title="No feedback yet" description="Nothing has been shared that you can see." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {feedback.map((f) => (
                  <li key={f.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={f.kind === 'RECOGNITION' ? 'accent' : 'neutral'}>
                        {f.recognition?.name ?? FEEDBACK_KIND_LABELS[f.kind as FeedbackKind] ?? f.kind}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        {f.authorName ??
                          (f.authorVisibility === 'ANONYMOUS' ? 'Anonymous' : 'Name withheld')}
                        {' · '}
                        {formatRelativeTime(f.createdAt)}
                      </span>
                    </div>
                    <ProseText className="mt-1.5">{f.body}</ProseText>
                    {(f.competencyName || f.goalTitle || f.projectTag) && (
                      <p className="mt-1.5 flex flex-wrap gap-1.5">
                        {f.competencyName && <Badge tone="info">{f.competencyName}</Badge>}
                        {f.goalTitle && <Badge tone="brand">{truncate(f.goalTitle, 40)}</Badge>}
                        {f.projectTag && <Badge tone="neutral">{f.projectTag}</Badge>}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {theirActions.length > 0 && (
            <Card>
              <CardHeader title="Open action items" description="From one-to-ones and development plans." />
              <ul className="divide-y divide-slate-100">
                {theirActions.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="min-w-0 text-sm text-slate-800">{a.title}</span>
                    <span className="flex-shrink-0 text-xs text-slate-500">
                      {a.dueDate ? formatDate(a.dueDate) : 'No due date'}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- development */}
      {current === 'development' && canSeeRecord && (
        <Card>
          <CardHeader
            title="Development and improvement plans"
            description="Improvement plans are restricted to this person, their direct manager and HR."
            actions={
              actor.isHrAdmin || actor.directReportIds.includes(id) ? (
                <ButtonLink href={`/development/new?employee=${id}`} size="sm">
                  Start a plan
                </ButtonLink>
              ) : undefined
            }
          />
          {visiblePlans.length === 0 ? (
            <EmptyState
              title="No plans"
              description="Nothing you can see. A development plan turns a review conversation into dated, owned actions."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {visiblePlans.map((p) => {
                const done = p.actions.filter((a) => a.status === 'COMPLETED').length;
                return (
                  <li key={p.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <Link href={`/development/${p.id}`} className="font-medium text-slate-900 hover:underline">
                          {p.title}
                        </Link>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <Badge tone={p.planType === 'PERFORMANCE_IMPROVEMENT' ? 'warning' : 'neutral'}>
                            {PLAN_TYPE_LABELS[p.planType as PlanType]}
                          </Badge>
                          {p.hrRestricted && (
                            <Badge tone="danger">
                              <ShieldCheck aria-hidden className="h-3 w-3" />
                              Restricted
                            </Badge>
                          )}
                          <span>
                            {done} of {p._count.actions} actions complete
                          </span>
                        </p>
                      </div>
                      <span className="flex-shrink-0 text-xs text-slate-500">
                        {p.targetDate ? `Target ${formatDate(p.targetDate)}` : ''}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {/* ------------------------------------------------ reporting history */}
      {current === 'history' && actor.isHrAdmin && (
        <Card>
          <CardHeader
            title="Reporting history"
            description="Append-only. Historical reviews resolve against this, which is why a transfer never changes who could read a past review."
          />
          <ul className="divide-y divide-slate-100">
            {employee.managerAssignments.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                <History aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-900">
                    {a.manager ? (
                      <>Reported to <strong>{fullName(a.manager)}</strong></>
                    ) : (
                      <span className="text-slate-500">No manager</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatDate(a.effectiveFrom)} —{' '}
                    {a.effectiveTo ? formatDate(a.effectiveTo) : 'present'}
                  </p>
                  {a.reason && <p className="mt-1 text-xs text-slate-600">{a.reason}</p>}
                </div>
                {!a.effectiveTo && <Badge tone="success">Current</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
