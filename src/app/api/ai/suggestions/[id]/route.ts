import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { decideSuggestion } from '@/server/ai/assist';

const Schema = z.object({
  decision: z.enum(['ACCEPTED', 'EDITED', 'DISCARDED']),
  acceptedText: z.string().max(20000).optional(),
});

/** Records what the person did with a suggestion, which is the audited part. */
export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, Schema);
  await decideSuggestion(actor, params.id as string, body.decision, body.acceptedText);
  return { ok: true };
});
