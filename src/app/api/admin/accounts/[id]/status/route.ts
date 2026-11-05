import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { setUserStatus } from '@/server/services/admin';

const Schema = z.object({ status: z.enum(['active', 'suspended']) });

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, Schema);
  await setUserStatus(actor, params.id as string, body.status);
  return { ok: true };
});
