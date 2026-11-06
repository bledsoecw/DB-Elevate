import { handler, parseBody } from '@/server/api';
import { DepartmentSchema } from '@/server/validation/admin';
import { createDepartment, listDepartments } from '@/server/services/catalog';

export const GET = handler(async ({ actor }) => {
  const departments = await listDepartments(actor);
  return { departments };
});

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, DepartmentSchema);
  const department = await createDepartment(actor, body);
  return { id: department.id };
});
