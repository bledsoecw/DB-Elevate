import Link from 'next/link';
import { ArrowRight, ClipboardCheck, FileText, Plus, Users } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import {
  listMyAssignments,
  listMyResults,
  listPendingApprovals,
  listVisibleParticipants,
} from '@/server/services/review-lists';
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  CardFooter,
  CardHeader,
  EmptyState,
  LinkTabs,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { formatDate, formatScore, relativeDueLabel, isOverdue } from '@/lib/utils';
import {
  ASSIGNMENT_STATUS_LABELS,
  PARTICIPANT_STATUS_LABELS,
  REVIEWER_KIND_LABELS,
  type AssignmentStatus,
  type ParticipantStatus,
  type ReviewerKind,
} from '@/lib/enums';

export const metadata = { title: 'Reviews' };

type Tab = 'mine' | 'team' | 'results' | 'approvals';

const PARTICIPANT_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success'> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'info',
  AWAITING_APPROVAL: 'warning',
  APPROVED: 'info',
  RELEASED: 'success',
  ACKNOWLEDGED: 'success',
  CLOSED: 'neutral',
};

function assignmentStatusTone(status: string): 'neutral' | 'info' | 'success' | 'warning' {
  if (status === 'SUBMITTED') return 'success';
  if (status === 'DRAFT') return 'info';
  if (status === 'REOPENED') return 'warning';
  return 'neutral';
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;

  const [assignments, participants, results, approvals] = await Promise.all([
    listMyAssignments(actor),
    listVisibleParticipants(actor, { includeClosed: true }),
    listMyResults(actor),
    listPendingApprovals(actor),
  ]);

  // Someone else's record, i.e. not my own self-assessment participant row.
  const teamParticipants = participants.filter((p) => p.employeeId !== actor.employeeId);
  const openAssignments = assignments.filter((a) =>
    ['NOT_STARTED', 'DRAFT', 'REOPENED'].includes(a.status),
  );

  const tabs: { key: Tab; label: string; href: string; count?: number }[] = [
    { key: 'mine', label: 'My reviews', href: '/reviews?tab=mine', count: openAssignments.length },
  ];
  if (teamParticipants.length > 0) {
    tabs.push({
      key: 'team',
      label: actor.isHrAdmin ? 'Everyone' : 'My team',
      href: '/reviews?tab=team',
      count: teamParticipants.length,
    });
  }
  tabs.push({ key: 'results', label: 'My results', href: '/reviews?tab=results', count: results.length });
  if (approvals.length > 0) {
    tabs.push({
      key: 'approvals',
      label: 'Approvals',
      href: '/reviews?tab=approvals',
      count: approvals.length,
    });
  }

  const requested = (sp.tab as Tab) ?? 'mine';
  const current: Tab = tabs.some((t) => t.key === requested) ? requested : 'mine';

  return (
    <>
      <PageHeader
        title="Reviews"
        description="Reviews you are writing, your team's progress, and the results that have been released to you."
        actions={
          actor.isHrAdmin ? (
            <>
              <ButtonLink href="/reviews/cycles">
                <ClipboardCheck aria-hidden className="h-4 w-4" />
                Manage cycles
              </ButtonLink>
              <ButtonLink href="/reviews/cycles/new" variant="primary">
                <Plus aria-hidden className="h-4 w-4" />
                New cycle
              </ButtonLink>
            </>
          ) : undefined
        }
      />

      <LinkTabs tabs={tabs} current={current} className="mb-5" />

      {/* -------------------------------------------------------- my reviews */}
      {current === 'mine' && (
        <Card>
          <CardHeader
            title="Reviews assigned to me"
            description="Nobody else can read a review you are writing until you submit it."
          />
          {assignments.length === 0 ? (
            <EmptyState
            illustration="forms"
              icon={<ClipboardCheck className="h-5 w-5" />}
              title="No reviews assigned to you"
              description="When HR launches a cycle that includes you, your self-assessment and any reviews you need to write will appear here."
            />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Review</Th>
                  <Th>Cycle</Th>
                  <Th>Due</Th>
                  <Th>Status</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assignments.map((a) => {
                  const subject = `${a.participant.employee.preferredName || a.participant.employee.firstName} ${a.participant.employee.lastName}`;
                  const isSelf = a.kind === 'SELF';
                  const open = ['NOT_STARTED', 'DRAFT', 'REOPENED'].includes(a.status);
                  return (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <Td>
                        <span className="flex items-center gap-2.5">
                          {!isSelf && (
                            <Avatar
                              firstName={a.participant.employee.firstName}
                              lastName={a.participant.employee.lastName}
                              size="xs"
                            />
                          )}
                          <span className="min-w-0">
                            <Link
                              href={`/reviews/assignments/${a.id}`}
                              className="font-medium text-slate-900 hover:underline"
                            >
                              {isSelf ? 'My self-assessment' : subject}
                            </Link>
                            <span className="block text-xs text-slate-500">
                              {REVIEWER_KIND_LABELS[a.kind as ReviewerKind] ?? a.kind}
                            </span>
                          </span>
                        </span>
                      </Td>
                      <Td className="text-slate-600">{a.participant.cycle.name}</Td>
                      <Td>
                        <span
                          className={
                            open && isOverdue(a.dueAt)
                              ? 'text-xs font-medium text-rose-700'
                              : 'text-xs text-slate-600'
                          }
                        >
                          {a.dueAt ? relativeDueLabel(a.dueAt) : '—'}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={assignmentStatusTone(a.status)}>
                          {ASSIGNMENT_STATUS_LABELS[a.status as AssignmentStatus] ?? a.status}
                        </Badge>
                      </Td>
                      <Td align="right">
                        <Link
                          href={`/reviews/assignments/${a.id}`}
                          className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
                        >
                          {open ? (a.status === 'NOT_STARTED' ? 'Start' : 'Continue') : 'View'}
                          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}

      {/* --------------------------------------------------------------- team */}
      {current === 'team' && (
        <Card>
          <CardHeader
            title={actor.isHrAdmin ? 'Everyone in a review cycle' : 'My reporting line'}
            description={
              actor.isHrAdmin
                ? 'Every participant in the organization.'
                : 'Resolved against the reporting line as it stood when each cycle launched — not against who reports to you today.'
            }
          />
          {teamParticipants.length === 0 ? (
            <EmptyState
            illustration="forms"
              icon={<Users className="h-5 w-5" />}
              title="No one in your reporting line is in a cycle"
              description="When a cycle that includes your team is launched, each person's progress shows here."
            />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Cycle</Th>
                  <Th>Self</Th>
                  <Th>Manager</Th>
                  <Th>Stage</Th>
                  <Th align="right">Score</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teamParticipants.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <Avatar firstName={p.firstName} lastName={p.lastName} size="xs" />
                        <span className="min-w-0">
                          <Link
                            href={`/reviews/participants/${p.id}`}
                            className="font-medium text-slate-900 hover:underline"
                          >
                            {p.employeeName}
                          </Link>
                          {p.jobTitle && (
                            <span className="block text-xs text-slate-500">{p.jobTitle}</span>
                          )}
                        </span>
                      </span>
                    </Td>
                    <Td className="text-slate-600">
                      {p.cycleName}
                      {p.managerNameSnapshot && (
                        <span className="block text-xs text-slate-400">
                          Manager of record: {p.managerNameSnapshot}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="text-xs text-slate-600">
                        {p.selfStatus
                          ? (ASSIGNMENT_STATUS_LABELS[p.selfStatus as AssignmentStatus] ?? p.selfStatus)
                          : 'Not assigned'}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-xs text-slate-600">
                        {p.managerStatus
                          ? (ASSIGNMENT_STATUS_LABELS[p.managerStatus as AssignmentStatus] ??
                            p.managerStatus)
                          : 'Not assigned'}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={PARTICIPANT_TONE[p.status] ?? 'neutral'}>
                        {PARTICIPANT_STATUS_LABELS[p.status as ParticipantStatus] ?? p.status}
                      </Badge>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {p.calibratedScore !== null ? (
                        <span title="Adjusted in calibration">
                          {formatScore(p.calibratedScore)}
                          <span className="ml-1 text-xs text-slate-400">adj.</span>
                        </span>
                      ) : (
                        formatScore(p.finalScore)
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}

      {/* ------------------------------------------------------------ results */}
      {current === 'results' && (
        <Card>
          <CardHeader
            title="My review results"
            description="Reviews that have been released to you. Earlier reviews stay here permanently."
          />
          {results.length === 0 ? (
            <EmptyState
            illustration="forms"
              icon={<FileText className="h-5 w-5" />}
              title="No results yet"
              description="Once a review about you has been completed and released, it appears here and stays available."
            />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Cycle</Th>
                  <Th>Period</Th>
                  <Th>Manager of record</Th>
                  <Th align="right">Score</Th>
                  <Th>Status</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-900">{r.cycle.name}</Td>
                    <Td className="text-slate-600">
                      {formatDate(r.cycle.periodStart)} — {formatDate(r.cycle.periodEnd)}
                    </Td>
                    <Td className="text-slate-600">{r.managerNameSnapshot ?? '—'}</Td>
                    <Td align="right" className="tabular-nums">
                      {formatScore(r.calibratedScore ?? r.finalScore)}
                    </Td>
                    <Td>
                      {r.status === 'RELEASED' ? (
                        <Badge tone="warning">Needs your acknowledgement</Badge>
                      ) : (
                        <Badge tone="success">Acknowledged</Badge>
                      )}
                    </Td>
                    <Td align="right">
                      <Link
                        href={`/reviews/results/${r.id}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
                      >
                        Read
                        <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}

      {/* ---------------------------------------------------------- approvals */}
      {current === 'approvals' && (
        <Card>
          <CardHeader
            title="Waiting for approval"
            description="Reviews that need a decision before the results can be released."
          />
          {approvals.length === 0 ? (
            <EmptyState
            illustration="forms" title="Nothing waiting on you" description="No reviews need your approval." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Cycle</Th>
                  <Th>Written by</Th>
                  <Th>Requested</Th>
                  <Th align="right">Score</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {approvals.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-900">
                      {a.participant.employee.preferredName || a.participant.employee.firstName}{' '}
                      {a.participant.employee.lastName}
                      {a.participant.employee.jobTitle && (
                        <span className="block text-xs font-normal text-slate-500">
                          {a.participant.employee.jobTitle.name}
                        </span>
                      )}
                    </Td>
                    <Td className="text-slate-600">{a.participant.cycle.name}</Td>
                    <Td className="text-slate-600">{a.participant.managerNameSnapshot ?? '—'}</Td>
                    <Td className="text-slate-600">{formatDate(a.requestedAt)}</Td>
                    <Td align="right" className="tabular-nums">
                      {formatScore(a.participant.finalScore)}
                    </Td>
                    <Td align="right">
                      <Link
                        href={`/reviews/participants/${a.participant.id}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
                      >
                        Review and decide
                        <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          {actor.isHrAdmin && approvals.length > 0 && (
            <CardFooter>
              <p className="text-xs text-slate-600">
                As an HR administrator you can see and decide every pending approval. The person
                originally assigned to each decision is shown on the review itself.
              </p>
            </CardFooter>
          )}
        </Card>
      )}
    </>
  );
}
