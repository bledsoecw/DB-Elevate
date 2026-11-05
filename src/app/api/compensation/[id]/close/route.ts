import { handler } from '@/server/api';
import { closeAllocation } from '@/server/services/compensation';

export const POST = handler(async ({ actor, params }) => {
  await closeAllocation(actor, params.id as string);
  return { ok: true };
});
