import { handler } from '@/server/api';
import { releaseParticipant } from '@/server/services/reviews';

export const POST = handler(async ({ actor, params }) => {
  await releaseParticipant(actor, params.id as string);
  return { ok: true };
});
