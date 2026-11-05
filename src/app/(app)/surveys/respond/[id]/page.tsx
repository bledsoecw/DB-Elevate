import { notFound } from 'next/navigation';
import { CheckCircle2, EyeOff, Users } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { getSurveyForRespondent } from '@/server/services/surveys';
import { isAppError } from '@/server/errors';
import { Alert, ButtonLink, Card, CardBody, PageHeader, ProseText } from '@/components/ui/primitives';
import { SurveyResponseForm } from './form';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Survey' };

export default async function RespondPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;

  let data: Awaited<ReturnType<typeof getSurveyForRespondent>>;
  try {
    data = await getSurveyForRespondent(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    if (isAppError(e) && e.status === 409) {
      return (
        <>
          <PageHeader breadcrumb={[{ label: 'Surveys', href: '/surveys' }]} title="Survey closed" />
          <Alert tone="neutral" title="This survey is not open">
            {e.message}
          </Alert>
        </>
      );
    }
    throw e;
  }

  const { survey, alreadyResponded, questions } = data;
  const anonymous = survey.mode === 'ANONYMOUS';

  if (alreadyResponded) {
    return (
      <>
        <PageHeader
          breadcrumb={[{ label: 'Surveys', href: '/surveys' }, { label: survey.title }]}
          title={survey.title}
        />
        <Card>
          <CardBody className="py-10 text-center">
            <CheckCircle2 aria-hidden className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
            <h2 className="text-lg font-semibold text-slate-900">Thank you — your response is in</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
              {anonymous
                ? 'Your answers were stored with no link to you. We can see that you took part, which is all the participation figures use, but not what you said.'
                : 'Your answers were recorded with your name, as this survey said they would be.'}
            </p>
            <div className="mt-5">
              <ButtonLink href="/surveys" variant="primary">
                Back to surveys
              </ButtonLink>
            </div>
          </CardBody>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Surveys', href: '/surveys' }, { label: survey.title }]}
        title={survey.title}
        description={survey.description ?? undefined}
      />

      <div className="max-w-3xl space-y-5">
        <Alert
          tone={anonymous ? 'success' : 'warning'}
          icon={anonymous ? <EyeOff className="h-4 w-4" /> : <Users className="h-4 w-4" />}
          title={anonymous ? 'This survey is anonymous' : 'This survey is NOT anonymous'}
        >
          {anonymous ? (
            <>
              <p>
                Your answers are stored with no record of who gave them. Participation is tracked
                separately, so we can chase people who have not responded without being able to see
                what anyone said.
              </p>
              <p className="mt-1.5">
                Results are only shown once at least {survey.minResponsesForResults} people have
                responded, and any group smaller than that stays hidden — including in exports.
                Written answers are only ever shown unfiltered and in a shuffled order.
              </p>
            </>
          ) : (
            <p>
              Your name is recorded with your answers and authorized administrators can read them
              individually. This is deliberate for this survey so specific issues can be followed up
              with you.
            </p>
          )}
        </Alert>

        {survey.introText && (
          <Card>
            <CardBody>
              <ProseText>{survey.introText}</ProseText>
              {survey.closesAt && (
                <p className="mt-3 text-xs text-slate-500">Closes {formatDate(survey.closesAt)}.</p>
              )}
            </CardBody>
          </Card>
        )}

        <SurveyResponseForm surveyId={survey.id} anonymous={anonymous} questions={questions} />
      </div>
    </>
  );
}
