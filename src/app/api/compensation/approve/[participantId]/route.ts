import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { decideCompensationApproval } from '@/server/services/compensation';

const Schema = z.object({
  decision: z.enum(['APPROVE', 'REQUEST_CHANGES']),
  note: z.string().trim().max(2000).nullable().optional(),
});

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, Schema);
  await decideCompensationApproval(
    actor,
    params.participantId as string,
    body.decision,
    body.note ?? null,
  );
  return { ok: true };
});
