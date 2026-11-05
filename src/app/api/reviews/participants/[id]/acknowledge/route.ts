import { handler, parseBody } from '@/server/api';
import { AcknowledgeSchema } from '@/server/validation/reviews';
import { acknowledgeParticipant } from '@/server/services/reviews';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, AcknowledgeSchema);
  await acknowledgeParticipant(actor, params.id as string, body.comment ?? null);
  return { ok: true };
});
