import { notFound, redirect } from 'next/navigation';
import { CheckCircle2, Printer } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { getParticipantDetail } from '@/server/services/reviews';
import { isAppError } from '@/server/errors';
import {
  Alert,
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
import { AcknowledgeForm } from './acknowledge-form';
import { formatDate, formatDateTime, fullName } from '@/lib/utils';
import { REVIEWER_KIND_LABELS, type ReviewerKind } from '@/lib/enums';

export const metadata = { title: 'Review results' };

/**
 * Released review results.
 *
 * This is the screen an employee reads and, with `?print=1`, the page that
 * prints or saves as a PDF. The print stylesheet drops the navigation and the
 * action panels and keeps the content, so the printed copy is the review and
 * nothing else.
 */
export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const actor = await requireActor();
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  let data: Awaited<ReturnType<typeof getParticipantDetail>>;
  try {
    data = await getParticipantDetail(actor, id);
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }

  const { participant, cycle, assignments, access, released } = data;
  const name = fullName(participant.employee);
  const isSubject = access === 'SUBJECT';
  const printMode = sp.print === '1';

  // Before release, the subject has no results page to look at; send them to
  // their task list rather than showing an empty shell.
  if (isSubject && !released) {
    redirect('/tasks');
  }

  const visible = assignments.filter((a) => a.sections !== null || a.withheldReason);
  const managerReview = visible.find((a) => a.kind === 'MANAGER');
  const selfReview = visible.find((a) => a.kind === 'SELF');
  const peerReviews = visible.filter((a) => a.kind === 'PEER');

  return (
    <div className={printMode ? 'print-plain' : undefined}>
      <PageHeader
        breadcrumb={
          printMode
            ? undefined
            : [{ label: 'Reviews', href: '/reviews' }, { label: cycle.name }]
        }
        title={isSubject ? `Your ${cycle.name}` : `${name} — ${cycle.name}`}
        description={
          <>
            Review period {formatDate(cycle.periodStart)} — {formatDate(cycle.periodEnd)} ·
            manager of record {participant.managerNameSnapshot ?? 'not recorded'}
          </>
        }
        meta={
          <>
            <Badge tone="success">Released {formatDate(participant.releasedAt)}</Badge>
            {participant.acknowledgedAt && (
              <Badge tone="success">
                <CheckCircle2 aria-hidden className="h-3 w-3" />
                Acknowledged {formatDate(participant.acknowledgedAt)}
              </Badge>
            )}
          </>
        }
        actions={
          <span className="no-print">
            <ButtonLink href={`/reviews/results/${participant.id}?print=1`} target="_blank">
              <Printer aria-hidden className="h-4 w-4" />
              Print or save as PDF
            </ButtonLink>
          </span>
        }
      />

      {printMode && (
        <p className="mb-5 hidden text-xs text-slate-500 print:block">
          {participant.employee.workEmail} · printed {formatDate(new Date())}
        </p>
      )}

      {isSubject && participant.status === 'RELEASED' && !printMode && (
        <Alert tone="warning" className="mb-5" title="Please acknowledge this review">
          Read it through, then acknowledge at the bottom of the page. Acknowledging records that you
          received it — it does <strong>not</strong> mean you agree with it, and you can add a
          comment of your own that is stored alongside.
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] print:block">
        <div className="min-w-0 space-y-5">
          {managerReview && (
            <Card className="print-break-inside-avoid">
              <CardHeader
                title="Manager review"
                description={
                  managerReview.reviewerName
                    ? `By ${managerReview.reviewerName} · submitted ${formatDate(managerReview.submittedAt)}`
                    : undefined
                }
              />
              {managerReview.sections ? (
                <ReviewAnswers sections={managerReview.sections} />
              ) : (
                <WithheldContent reason={managerReview.withheldReason ?? ''} />
              )}
            </Card>
          )}

          {selfReview && (
            <Card className="print-break-inside-avoid">
              <CardHeader
                title={isSubject ? 'Your self-assessment' : 'Self-assessment'}
                description={
                  selfReview.submittedAt ? `Submitted ${formatDate(selfReview.submittedAt)}` : undefined
                }
              />
              {selfReview.sections ? (
                <ReviewAnswers sections={selfReview.sections} />
              ) : (
                <WithheldContent reason={selfReview.withheldReason ?? ''} />
              )}
            </Card>
          )}

          {peerReviews.length > 0 && (
            <Card className="print-break-inside-avoid">
              <CardHeader
                title={`Peer feedback (${peerReviews.length})`}
                description={
                  cycle.peerVisibilityMode === 'NAMED'
                    ? 'Each response is shown with the name of the person who wrote it.'
                    : cycle.peerVisibilityMode === 'CONFIDENTIAL'
                      ? 'Responses are shown without naming who wrote them.'
                      : 'Peer responses in this cycle are only ever shown combined.'
                }
              />
              <div className="divide-y divide-slate-200">
                {peerReviews.map((p, i) => (
                  <div key={p.id}>
                    <p className="bg-slate-50 px-5 py-2 text-xs font-medium text-slate-600">
                      {p.reviewerHidden
                        ? `${REVIEWER_KIND_LABELS[p.kind as ReviewerKind] ?? 'Peer'} response ${i + 1}`
                        : p.reviewerName}
                    </p>
                    {p.sections ? (
                      <ReviewAnswers sections={p.sections} />
                    ) : (
                      <WithheldContent reason={p.withheldReason ?? ''} />
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {participant.acknowledgementNote && (
            <Card className="print-break-inside-avoid">
              <CardHeader
                title={isSubject ? 'Your comment' : 'Employee comment'}
                description={`Added when acknowledging on ${formatDate(participant.acknowledgedAt)}.`}
              />
              <CardBody>
                <ProseText>{participant.acknowledgementNote}</ProseText>
              </CardBody>
            </Card>
          )}

          {isSubject && participant.status === 'RELEASED' && !printMode && (
            <div className="no-print">
              <AcknowledgeForm participantId={participant.id} cycleName={cycle.name} />
            </div>
          )}
        </div>

        <aside className="space-y-5 print:mt-5">
          <ScoreBreakdown
            finalScoreJson={participant.finalScoreJson}
            finalScore={participant.finalScore}
            calibratedScore={participant.calibratedScore}
            calibrationNote={participant.calibrationNote}
            assignmentBreakdowns={undefined}
          />

          {data.goalSnapshots.length > 0 && (
            <Card className="print-break-inside-avoid">
              <CardHeader
                title="Goals as they stood"
                description="Frozen at release, so later goal changes do not alter this record."
                level={3}
              />
              <ul className="divide-y divide-slate-100">
                {data.goalSnapshots.map((g) => (
                  <li key={g.id} className="px-5 py-2.5">
                    <p className="text-sm font-medium text-slate-900">{g.titleSnapshot}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {g.statusSnapshot.replace(/_/g, ' ').toLowerCase()}
                      {g.progressSnapshot !== null && ` · ${Math.round(g.progressSnapshot)}%`}
                      {g.dueDateSnapshot && ` · was due ${formatDate(g.dueDateSnapshot)}`}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="print-break-inside-avoid">
            <CardHeader title="Record" level={3} />
            <CardBody>
              <DetailList cols={1}>
                <DetailItem label="Employee">{name}</DetailItem>
                <DetailItem label="Role at the time">
                  {participant.jobTitleNameSnapshot ?? '—'}
                  {participant.departmentNameSnapshot && `, ${participant.departmentNameSnapshot}`}
                </DetailItem>
                <DetailItem label="Manager of record">
                  {participant.managerNameSnapshot ?? '—'}
                </DetailItem>
                <DetailItem label="Released">{formatDateTime(participant.releasedAt)}</DetailItem>
                {participant.acknowledgedAt && (
                  <DetailItem label="Acknowledged">
                    {formatDateTime(participant.acknowledgedAt)}
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Receipt only — not agreement.
                    </span>
                  </DetailItem>
                )}
              </DetailList>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
