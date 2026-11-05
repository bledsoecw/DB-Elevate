import { handler, parseBody } from '@/server/api';
import { GoalSchema } from '@/server/validation/goals';
import { createGoal } from '@/server/services/goals';

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, GoalSchema);
  const goal = await createGoal(actor, body);
  return { id: goal.id };
});
