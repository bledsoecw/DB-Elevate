import { handler, parseBody } from '@/server/api';
import { PlanCheckInSchema } from '@/server/validation/admin';
import { addPlanCheckIn } from '@/server/services/development';

/** Check-ins are append-only: there is deliberately no edit or delete route. */
export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, PlanCheckInSchema);
  await addPlanCheckIn(actor, params.id as string, body.body);
  return { ok: true };
});
