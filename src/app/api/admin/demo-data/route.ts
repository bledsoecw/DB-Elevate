import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { removeDemoData } from '@/server/services/admin';

const Schema = z.object({ confirmation: z.string() });

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, Schema);
  return removeDemoData(actor, body.confirmation);
});
