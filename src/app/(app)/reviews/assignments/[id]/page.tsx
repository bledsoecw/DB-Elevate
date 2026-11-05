import { notFound } from 'next/navigation';
import { CalendarClock, Lock, RotateCcw } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { getAssignmentForEditing } from '@/server/services/reviews';
import { isAppError } from '@/server/errors';
import { Alert, Badge, PageHeader } from '@/components/ui/primitives';
import { formatDate, fullName, relativeDueLabel, isOverdue } from '@/lib/utils';
import { ASSIGNMENT_STATUS_LABELS, REVIEWER_KIND_LABELS, type AssignmentStatus, type ReviewerKind } from '@/lib/enums';
import { ReviewForm } from './review-form';

export const metadata = { title: 'Review' };

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;

  let data: Awaited<ReturnType<typeof getAssignmentForEditing>>;
  try {
    data = await getAssignmentForEditing(actor, id);
  } catch (e) {
    if (isAppError(e) && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }

  const { assignment, participant, cycle, form, selfReview, editable } = data;
  const subject = fullName(participant.employee);
  const isSelf = assignment.kind === 'SELF';

  const title = isSelf
    ? 'Your self-assessment'
    : `${REVIEWER_KIND_LABELS[assignment.kind as ReviewerKind] ?? assignment.kind} — ${subject}`;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Reviews', href: '/reviews' },
          { label: cycle.name, href: `/reviews/cycles/${cycle.id}` },
          { label: isSelf ? 'My self-assessment' : subject },
        ]}
        title={title}
        description={
          <>
            {cycle.name} · review period {formatDate(cycle.periodStart)} —{' '}
            {formatDate(cycle.periodEnd)}
            {!isSelf && participant.jobTitleSnapshot && (
              <>
                {' '}
                · {participant.jobTitleSnapshot}
                {participant.departmentSnapshot ? `, ${participant.departmentSnapshot}` : ''}
              </>
            )}
          </>
        }
        meta={
          <>
            <Badge tone={assignment.status === 'SUBMITTED' ? 'success' : 'neutral'}>
              {ASSIGNMENT_STATUS_LABELS[assignment.status as AssignmentStatus] ?? assignment.status}
            </Badge>
            {assignment.dueAt && (
              <Badge tone={isOverdue(assignment.dueAt) && editable ? 'danger' : 'neutral'}>
                <CalendarClock aria-hidden className="h-3 w-3" />
                {relativeDueLabel(assignment.dueAt)}
              </Badge>
            )}
            {assignment.kind === 'PEER' && (
              <Badge tone="info">
                <Lock aria-hidden className="h-3 w-3" />
                {cycle.peerVisibilityMode === 'NAMED'
                  ? 'Your name is shown with this feedback'
                  : cycle.peerVisibilityMode === 'CONFIDENTIAL'
                    ? `${subject} will not see who wrote this`
                    : 'Shown only combined with other peer responses'}
              </Badge>
            )}
          </>
        }
      />

      {assignment.status === 'REOPENED' && assignment.reopenReason && (
        <Alert
          tone="warning"
          className="mb-5"
          title="This review was reopened for editing"
          icon={<RotateCcw className="h-4 w-4" />}
        >
          <p>{assignment.reopenReason}</p>
          <p className="mt-1 text-xs">
            Make the changes and submit again. This is submission number{' '}
            {assignment.submissionCount + 1}.
          </p>
        </Alert>
      )}

      {assignment.kind === 'PEER' && (
        <Alert tone="info" className="mb-5" title="Who sees this">
          {cycle.peerVisibilityMode === 'ANONYMOUS_AGGREGATE' ? (
            <>
              Your answers are only ever shown combined with the other peer responses, and only once
              enough people have responded. Nobody sees your individual answers — not {subject}, not
              their manager, not HR.
            </>
          ) : cycle.peerVisibilityMode === 'CONFIDENTIAL' ? (
            <>
              {subject}&rsquo;s manager and HR administrators can read what you write and will see
              your name. {subject} will see the content
              {cycle.sharePeerWithEmployee ? ' but not who wrote it' : ' only if HR chooses to share peer feedback in this cycle'}.
            </>
          ) : (
            <>Your name is shown with this feedback to everyone who can see the review, including {subject}.</>
          )}
        </Alert>
      )}

      {form.sections.length === 0 ? (
        <Alert tone="neutral" title="There is nothing for you to answer">
          This template does not ask anything of a{' '}
          {REVIEWER_KIND_LABELS[assignment.kind as ReviewerKind]?.toLowerCase() ?? 'reviewer'} for this
          cycle. Let an HR administrator know — the assignment should probably not exist.
        </Alert>
      ) : (
        <ReviewForm
          assignmentId={assignment.id}
          form={form}
          initialStatus={assignment.status}
          initialSavedAt={assignment.lastSavedAt?.toISOString() ?? null}
          editable={editable}
          selfReview={
            selfReview
              ? {
                  sections: selfReview.sections,
                  submittedAt: selfReview.submittedAt?.toISOString() ?? null,
                }
              : null
          }
          subjectName={subject}
          isSelf={isSelf}
        />
      )}
    </>
  );
}
