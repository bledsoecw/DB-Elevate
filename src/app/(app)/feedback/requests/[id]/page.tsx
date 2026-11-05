import { notFound } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { getFeedbackRequest, listRecognitionValues } from '@/server/services/feedback';
import { listGoals } from '@/server/services/goals';
import { prisma } from '@/server/db';
import { isAppError } from '@/server/errors';
import { Alert, Card, CardBody, CardHeader, PageHeader, ProseText } from '@/components/ui/primitives';
import { FeedbackForm } from '../../feedback-form';
import { DeclineRequest } from './decline';
import { formatDate, fullName } from '@/lib/utils';

export const metadata = { title: 'Feedback request' };

export default async function FeedbackRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;

  let data: Awaited<ReturnType<typeof getFeedbackRequest>>;
  try {
    data = await getFeedbackRequest(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }

  const { request, canRespond } = data;
  const aboutName = fullName(request.about);

  const [people, competencies, recognitionValues, goals] = await Promise.all([
    prisma.employee.findMany({
      where: { id: request.aboutEmployeeId },
      select: { id: true, firstName: true, lastName: true, preferredName: true },
    }),
    prisma.competency.findMany({
      where: { orgId: actor.orgId, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    listRecognitionValues(actor.orgId),
    listGoals(actor, { ownerEmployeeId: request.aboutEmployeeId }),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Feedback', href: '/feedback' }, { label: 'Request' }]}
        title={`Feedback about ${aboutName}`}
        description={`${fullName(request.requester)} asked for this${request.dueAt ? `, by ${formatDate(request.dueAt)}` : ''}.`}
      />

      {request.message && (
        <Card className="mb-5">
          <CardHeader title="What they asked for" />
          <CardBody>
            <ProseText>{request.message}</ProseText>
            {request.competency && (
              <p className="mt-3 text-sm text-slate-600">
                <strong className="text-slate-800">Focus:</strong> {request.competency.name}
                {request.competency.description ? ` — ${request.competency.description}` : ''}
              </p>
            )}
            {request.goal && (
              <p className="mt-1 text-sm text-slate-600">
                <strong className="text-slate-800">Goal:</strong> {request.goal.title}
              </p>
            )}
            {request.projectTag && (
              <p className="mt-1 text-sm text-slate-600">
                <strong className="text-slate-800">Project:</strong> {request.projectTag}
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {!canRespond ? (
        <Alert tone="neutral" title={request.status === 'COMPLETED' ? 'Already answered' : 'Nothing to do'}>
          {request.status === 'COMPLETED'
            ? 'This request has been answered.'
            : request.status === 'DECLINED'
              ? 'This request was declined.'
              : 'You are not the person being asked.'}
        </Alert>
      ) : (
        <>
          <FeedbackForm
            people={people}
            competencies={competencies}
            recognitionValues={recognitionValues}
            goals={goals.map((g) => ({ id: g.id, title: g.title }))}
            defaults={{
              aboutEmployeeId: request.aboutEmployeeId,
              kind: 'GENERAL',
              visibility: request.responseVisibility,
            }}
            requestId={request.id}
            lockAbout
          />
          <div className="mt-5 max-w-3xl">
            <DeclineRequest requestId={request.id} />
          </div>
        </>
      )}
    </>
  );
}
