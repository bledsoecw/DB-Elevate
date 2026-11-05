import { handler, parseBody } from '@/server/api';
import { EmployeePatchSchema } from '@/server/validation/people';
import { updateEmployee } from '@/server/services/people';

export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, EmployeePatchSchema);
  await updateEmployee(actor, params.id as string, body);
  return { ok: true };
});
