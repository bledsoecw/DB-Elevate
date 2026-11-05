import { handler, parseBody } from '@/server/api';
import { DevelopmentPlanPatchSchema } from '@/server/validation/admin';
import { updatePlan } from '@/server/services/development';

export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, DevelopmentPlanPatchSchema);
  await updatePlan(actor, params.id as string, body);
  return { ok: true };
});
