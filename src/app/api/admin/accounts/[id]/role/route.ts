import { handler, parseBody } from '@/server/api';
import { RoleGrantSchema } from '@/server/validation/admin';
import { setUserRole } from '@/server/services/admin';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, RoleGrantSchema);
  await setUserRole(actor, params.id as string, body.role, body.granted);
  return { ok: true };
});
