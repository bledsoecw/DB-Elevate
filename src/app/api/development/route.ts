import { handler, parseBody } from '@/server/api';
import { DevelopmentPlanSchema } from '@/server/validation/admin';
import { createPlan } from '@/server/services/development';

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, DevelopmentPlanSchema);
  const plan = await createPlan(actor, body);
  return { id: plan.id };
});
