import { handler, parseBody } from '@/server/api';
import { GoalUpdateSchema } from '@/server/validation/goals';
import { addGoalUpdate } from '@/server/services/goals';

/** Appends a progress update; never overwrites the previous one. */
export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, GoalUpdateSchema);
  const result = await addGoalUpdate(actor, params.id as string, body);
  return {
    ok: true,
    reportedPct: result.progress.reportedPct,
    computedPct: result.progress.computedPct,
    displayPct: result.progress.displayPct,
    source: result.progress.source,
  };
});
