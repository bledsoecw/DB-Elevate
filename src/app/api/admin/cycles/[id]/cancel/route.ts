import { handler, parseBody } from '@/server/api';
import { CancelCycleSchema } from '@/server/validation/admin';
import { cancelCycle } from '@/server/services/cycles';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, CancelCycleSchema);
  await cancelCycle(actor, params.id as string, body.reason);
  return { ok: true };
});
