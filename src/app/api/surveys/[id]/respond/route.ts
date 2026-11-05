import { handler, parseBody } from '@/server/api';
import { SurveyResponseSchema } from '@/server/validation/surveys';
import { submitResponse } from '@/server/services/surveys';

/**
 * For an anonymous survey this writes no respondent identity at all; only the
 * invitation row records that the person took part.
 */
export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, SurveyResponseSchema);
  await submitResponse(actor, params.id as string, body.answers);
  return { ok: true };
});
