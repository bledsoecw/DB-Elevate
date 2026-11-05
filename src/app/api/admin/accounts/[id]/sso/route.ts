import { handler } from '@/server/api';
import { unlinkSsoIdentity } from '@/server/services/admin';

/** Clears an account's link to a Google identity. See docs/SSO.md. */
export const DELETE = handler(async ({ actor, params }) => {
  await unlinkSsoIdentity(actor, params.id as string);
  return { ok: true };
});
