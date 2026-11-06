import { handler, parseBody } from '@/server/api';
import { DepartmentPatchSchema } from '@/server/validation/admin';
import { updateDepartment } from '@/server/services/catalog';

export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, DepartmentPatchSchema);
  await updateDepartment(actor, params.id as string, body);
  return { ok: true };
});
