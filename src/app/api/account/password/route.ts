import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { changeOwnPassword } from '@/server/services/account';

const Schema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().min(1, 'Enter a new password.'),
});

/**
 * Scoped to the signed-in user by construction — there is no account id in the
 * request, so this route cannot be aimed at anyone else.
 */
export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, Schema);
  return changeOwnPassword(actor, body.currentPassword, body.newPassword);
});
