import { handler, parseBody } from '@/server/api';
import { GoalCloseSchema } from '@/server/validation/goals';
import { closeGoal } from '@/server/services/goals';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, GoalCloseSchema);
  await closeGoal(actor, params.id as string, body.status, body.note);
  return { ok: true };
});
