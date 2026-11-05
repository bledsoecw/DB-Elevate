import { handler, parseBody } from '@/server/api';
import { SurveySchema } from '@/server/validation/surveys';
import { createSurvey } from '@/server/services/surveys';

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, SurveySchema);
  const survey = await createSurvey(actor, body);
  return { id: survey.id };
});
