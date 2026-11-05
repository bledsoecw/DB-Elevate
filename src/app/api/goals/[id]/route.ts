import { handler, parseBody } from '@/server/api';
import { GoalPatchSchema } from '@/server/validation/goals';
import { updateGoal } from '@/server/services/goals';

export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, GoalPatchSchema);
  await updateGoal(actor, params.id as string, body);
  return { ok: true };
});
