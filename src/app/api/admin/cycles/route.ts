import { handler, parseBody } from '@/server/api';
import { CycleSchema } from '@/server/validation/admin';
import { createCycle } from '@/server/services/cycles';

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, CycleSchema);
  const cycle = await createCycle(actor, body);
  return { id: cycle.id };
});
