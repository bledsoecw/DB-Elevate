import { handler, parseBody } from '@/server/api';
import { CalibrateSchema } from '@/server/validation/reviews';
import { calibrateParticipant } from '@/server/services/reviews';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, CalibrateSchema);
  await calibrateParticipant(actor, params.id as string, body.score, body.note);
  return { ok: true };
});
