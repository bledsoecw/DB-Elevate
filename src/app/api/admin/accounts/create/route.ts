import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { Id } from '@/server/validation/common';
import { createAccountForEmployee } from '@/server/services/admin';

const Schema = z.object({
  employeeId: Id,
  temporaryPassword: z.string().min(10, 'Use at least 10 characters.').max(200),
});

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, Schema);
  return createAccountForEmployee(actor, body.employeeId, body.temporaryPassword);
});
