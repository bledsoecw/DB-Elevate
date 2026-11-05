import { handler, parseBody } from '@/server/api';
import { EmployeeSchema } from '@/server/validation/people';
import { createEmployee } from '@/server/services/people';

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, EmployeeSchema);
  const employee = await createEmployee(actor, body);
  return { id: employee.id };
});
