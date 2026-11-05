import { handler } from '@/server/api';
import { reactivateEmployee } from '@/server/services/people';

export const POST = handler(async ({ actor, params }) => {
  await reactivateEmployee(actor, params.id as string);
  return { ok: true };
});
