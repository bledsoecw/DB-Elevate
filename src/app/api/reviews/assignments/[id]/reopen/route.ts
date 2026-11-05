import { handler, parseBody } from '@/server/api';
import { ReopenSchema } from '@/server/validation/reviews';
import { reopenAssignment } from '@/server/services/reviews';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, ReopenSchema);
  await reopenAssignment(actor, params.id as string, body.reason);
  return { ok: true };
});
