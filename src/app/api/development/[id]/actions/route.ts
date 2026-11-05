import { handler, parseBody } from '@/server/api';
import { PlanActionSchema } from '@/server/validation/admin';
import { upsertPlanAction } from '@/server/services/development';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, PlanActionSchema);
  await upsertPlanAction(actor, params.id as string, body);
  return { ok: true };
});
