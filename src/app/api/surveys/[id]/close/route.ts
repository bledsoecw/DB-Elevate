import { handler } from '@/server/api';
import { closeSurvey } from '@/server/services/surveys';

export const POST = handler(async ({ actor, params }) => {
  await closeSurvey(actor, params.id as string);
  return { ok: true };
});
