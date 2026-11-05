import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Clock, Send, ShieldCheck } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { getParticipantDetail } from '@/server/services/reviews';
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
  ProseText,
} from '@/components/ui/primitives';
import { ReviewAnswers, WithheldContent } from '@/components/reviews/review-answers';
import { ScoreBreakdown } from '@/components/reviews/score-breakdown';
import { ReleaseControls, ApprovalControls, ReopenControl, CalibrateControl } from './controls';
import { formatDate, formatDateTime, fullName, relativeDueLabel } from '@/lib/utils';
import {
  ASSIGNMENT_STATUS_LABELS,
  PARTICIPANT_STATUS_LABELS,
  REVIEWER_KIND_LABELS,
  type AssignmentStatus,
  type ParticipantStatus,
  type ReviewerKind,
} from '@/lib/enums';

export const metadata = { title: 'Review record' };

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success'> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'info',
  AWAITING_APPROVAL: 'warning',
  APPROVED: 'info',
  RELEASED: 'success',
  ACKNOWLEDGED: 'success',
  CLOSED: 'neutral',
};

export default async function ParticipantPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;

  let data: Awaited<ReturnType<typeof getParticipantDetail>>;
  try {
    data = await getParticipantDetail(actor, id);
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }

  const { participant, cycle, assignments, approvals, access, released } = data;
  const name = fullName(participant.employee);
  const pendingApproval = approvals.find((a) => a.status === 'PENDING');

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Reviews', href: '/reviews' },
          { label: cycle.name, href: `/reviews/cycles/${cycle.id}` },
          { label: name },
        ]}
        title={name}
        description={
          <>
            {participant.jobTitleNameSnapshot}
            {participant.departmentNameSnapshot ? `, ${participant.departmentNameSnapshot}` : ''} ·
            review period {formatDate(cycle.periodStart)} — {formatDate(cycle.periodEnd)}
          </>
        }
        meta={
          <>
            <Badge tone={STATUS_TONE[participant.status] ?? 'neutral'}>
              {PARTICIPANT_STATUS_LABELS[participant.status as ParticipantStatus] ?? participant.status}
            </Badge>
            {access === 'HR' && <Badge tone="brand">HR administrator view</Badge>}
            {access === 'MANAGER_OF_RECORD' && <Badge tone="brand">You are the manager of record</Badge>}
            {access === 'UPPER_CHAIN_OF_RECORD' && <Badge tone="brand">Management chain</Badge>}
          </>
        }
        actions={
          <>
            {released && (
              <ButtonLink href={`/reviews/results/${participant.id}?print=1`} target="_blank">
                Printable version
              </ButtonLink>
            )}
            <ReleaseControls
              participantId={participant.id}
              canRelease={data.canRelease}
              employeeName={name}
              requiresApproval={cycle.requireApproval}
              status={participant.status}
            />
          </>
        }
      />

      {/* Snapshot explanation — the thing people most often misunderstand. */}
      <Alert tone="neutral" className="mb-5" icon={<ShieldCheck className="h-4 w-4" />}>
        This record was fixed to the organization as it stood on{' '}
        {formatDate(participant.snapshotTakenAt ?? cycle.launchedAt)}. The manager of record is{' '}
        <strong>{participant.managerNameSnapshot ?? 'not recorded'}</strong>, and the questions are
        the version of the template in use then. Later changes to reporting lines or to the template
        do not alter what is held here.
      </Alert>

      {pendingApproval && (
        <div className="mb-5">
          <ApprovalControls
            participantId={participant.id}
            canApprove={data.canApprove}
            approverName={
              pendingApproval.approver
                ? `${pendingApproval.approver.preferredName || pendingApproval.approver.firstName} ${pendingApproval.approver.lastName}`
                : 'Not assigned'
            }
            employeeName={name}
            requestedAt={pendingApproval.requestedAt.toISOString()}
          />
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          {assignments.map((a) => (
            <Card key={a.id}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {REVIEWER_KIND_LABELS[a.kind as ReviewerKind] ?? a.kind}
                    <Badge tone={a.status === 'SUBMITTED' ? 'success' : 'neutral'}>
                      {ASSIGNMENT_STATUS_LABELS[a.status as AssignmentStatus] ?? a.status}
                    </Badge>
                  </span>
                }
                description={
                  <>
                    {a.reviewerHidden ? (
                      <span className="italic">
                        Reviewer name withheld —{' '}
                        {cycle.peerVisibilityMode === 'ANONYMOUS_AGGREGATE'
                          ? 'this cycle collects peer responses anonymously'
                          : 'peer reviews in this cycle are confidential'}
                      </span>
                    ) : (
                      <>By {a.reviewerName}</>
                    )}
                    {a.submittedAt && ` · submitted ${formatDate(a.submittedAt)}`}
                    {!a.submittedAt && a.dueAt && ` · ${relativeDueLabel(a.dueAt)}`}
                  </>
                }
                actions={
                  <>
                    {a.score !== null && (
                      <Badge tone="brand" title="Score for this review alone">
                        {a.score.toFixed(1)} / 100
                      </Badge>
                    )}
                    {a.status === 'SUBMITTED' && data.canReopen && (
                      <ReopenControl assignmentId={a.id} kind={a.kind} />
                    )}
                  </>
                }
              />
              {a.sections ? (
                <ReviewAnswers sections={a.sections} />
              ) : (
                <WithheldContent reason={a.withheldReason ?? 'Not available.'} />
              )}
            </Card>
          ))}

          {assignments.length === 0 && (
            <Card>
              <CardBody>
                <p className="text-sm text-slate-600">
                  No reviewers have been assigned to this person yet.
                </p>
              </CardBody>
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <ScoreBreakdown
            finalScoreJson={participant.finalScoreJson}
            finalScore={participant.finalScore}
            calibratedScore={participant.calibratedScore}
            calibrationNote={participant.calibrationNote}
            assignmentBreakdowns={undefined}
          />

          {data.canCalibrate && (
            <CalibrateControl
              participantId={participant.id}
              currentScore={participant.finalScore}
              calibratedScore={participant.calibratedScore}
              employeeName={name}
            />
          )}

          <Card>
            <CardHeader title="Record" level={3} />
            <CardBody>
              <DetailList cols={1}>
                <DetailItem label="Employee">
                  <span className="flex items-center gap-2">
                    <Avatar
                      firstName={participant.employee.firstName}
                      lastName={participant.employee.lastName}
                      size="xs"
                    />
                    <Link href={`/people/${participant.employee.id}`} className="hover:underline">
                      {name}
                    </Link>
                  </span>
                </DetailItem>
                <DetailItem label="Manager of record">
                  {participant.managerNameSnapshot ?? 'None recorded'}
                </DetailItem>
                <DetailItem label="Snapshot taken">
                  {formatDate(participant.snapshotTakenAt)}
                </DetailItem>
                {participant.releasedAt && (
                  <DetailItem label="Released">
                    {formatDateTime(participant.releasedAt)}
                    {participant.releasedByName && (
                      <span className="block text-xs text-slate-500">
                        by {participant.releasedByName}
                      </span>
                    )}
                  </DetailItem>
                )}
                {participant.acknowledgedAt && (
                  <DetailItem label="Acknowledged">
                    <span className="flex items-center gap-1.5 text-emerald-700">
                      <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
                      {formatDateTime(participant.acknowledgedAt)}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Acknowledgement records receipt, not agreement.
                    </span>
                  </DetailItem>
                )}
              </DetailList>

              {participant.acknowledgementNote && (
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Employee comment
                  </p>
                  <ProseText className="mt-1">{participant.acknowledgementNote}</ProseText>
                </div>
              )}
            </CardBody>
          </Card>

          {approvals.length > 0 && (
            <Card>
              <CardHeader title="Approval history" level={3} />
              <ul className="divide-y divide-slate-100">
                {approvals.map((ap) => (
                  <li key={ap.id} className="px-5 py-3">
                    <p className="flex items-center gap-2 text-sm">
                      <Badge
                        tone={
                          ap.status === 'APPROVED'
                            ? 'success'
                            : ap.status === 'CHANGES_REQUESTED'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {ap.status === 'APPROVED'
                          ? 'Approved'
                          : ap.status === 'CHANGES_REQUESTED'
                            ? 'Changes requested'
                            : 'Pending'}
                      </Badge>
                      <span className="text-slate-700">
                        {ap.approver
                          ? `${ap.approver.preferredName || ap.approver.firstName} ${ap.approver.lastName}`
                          : 'Unassigned'}
                      </span>
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <Clock aria-hidden className="h-3 w-3" />
                      {ap.decidedAt
                        ? `Decided ${formatDateTime(ap.decidedAt)}`
                        : `Requested ${formatDateTime(ap.requestedAt)}`}
                    </p>
                    {ap.note && <ProseText className="mt-1.5 text-xs">{ap.note}</ProseText>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.goalSnapshots.length > 0 && (
            <Card>
              <CardHeader
                title="Goals as they stood"
                description="Frozen when the results were released, so later goal edits do not rewrite this review."
                level={3}
              />
              <ul className="divide-y divide-slate-100">
                {data.goalSnapshots.map((g) => (
                  <li key={g.id} className="px-5 py-2.5">
                    <p className="text-sm font-medium text-slate-900">{g.titleSnapshot}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {g.statusSnapshot.replace(/_/g, ' ').toLowerCase()}
                      {g.progressSnapshot !== null && ` · ${Math.round(g.progressSnapshot)}%`}
                      {g.targetSnapshot && ` · target ${g.targetSnapshot}`}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {released && (
            <Card>
              <CardBody>
                <p className="flex items-start gap-2 text-sm text-slate-700">
                  <Send aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                  <span>
                    {name} can read these results. Reviews cannot be edited after release — a
                    correction means closing the cycle and recording a new one.
                  </span>
                </p>
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
