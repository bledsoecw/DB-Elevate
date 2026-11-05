import { handler, parseBody } from '@/server/api';
import { DeclineSchema } from '@/server/validation/feedback';
import { declineFeedbackRequest } from '@/server/services/feedback';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, DeclineSchema);
  await declineFeedbackRequest(actor, params.id as string, body.reason ?? null);
  return { ok: true };
});
