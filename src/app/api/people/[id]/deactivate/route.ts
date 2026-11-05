import { handler, parseBody } from '@/server/api';
import { DeactivateSchema } from '@/server/validation/people';
import { deactivateEmployee } from '@/server/services/people';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, DeactivateSchema);
  return deactivateEmployee(actor, params.id as string, {
    reason: body.reason,
    terminationDate: body.terminationDate ? new Date(body.terminationDate) : undefined,
  });
});
