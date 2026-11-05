import { handler, parseBody } from '@/server/api';
import { GoalCommentSchema } from '@/server/validation/goals';
import { addGoalComment } from '@/server/services/goals';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, GoalCommentSchema);
  const comment = await addGoalComment(actor, params.id as string, body.body);
  return { id: comment.id };
});
