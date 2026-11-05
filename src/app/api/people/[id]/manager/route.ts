import { handler, parseBody } from '@/server/api';
import { ManagerChangeSchema } from '@/server/validation/people';
import { changeManager } from '@/server/services/people';

/**
 * A reporting-line change. Recorded as an event with an effective date, so
 * historical reviews keep the manager who actually wrote them.
 */
export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, ManagerChangeSchema);
  await changeManager(
    actor,
    params.id as string,
    body.managerId,
    body.reason,
    body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
  );
  return { ok: true };
});
