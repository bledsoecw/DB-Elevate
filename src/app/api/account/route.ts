import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { updateOwnContact } from '@/server/services/account';

const Schema = z.object({
  preferredName: z.string().trim().max(80).nullable().optional(),
  workPhone: z.string().trim().max(40).nullable().optional(),
});

export const PATCH = handler(async ({ actor, request }) => {
  const body = await parseBody(request, Schema);
  await updateOwnContact(actor, body);
  return { ok: true };
});
