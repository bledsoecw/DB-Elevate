import { handler, parseBody } from '@/server/api';
import { PasswordResetSchema } from '@/server/validation/admin';
import { resetUserPassword } from '@/server/services/admin';

/**
 * The temporary password is accepted, hashed and forgotten. It is never echoed
 * back, stored in plain text, or written to the audit log.
 */
export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, PasswordResetSchema);
  await resetUserPassword(actor, params.id as string, body.temporaryPassword);
  return { ok: true };
});
