import { handler, parseBody } from '@/server/api';
import { CyclePatchSchema } from '@/server/validation/admin';
import { updateCycle } from '@/server/services/cycles';

export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, CyclePatchSchema);
  await updateCycle(actor, params.id as string, body);
  return { ok: true };
});
