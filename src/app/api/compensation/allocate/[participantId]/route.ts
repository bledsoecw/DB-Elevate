import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { allocateCompensation } from '@/server/services/compensation';

const Schema = z.object({
  /** Basis points: 325 === 3.25%. Null clears the decision. */
  bp: z.number().int().min(0).max(10_000).nullable(),
  rationale: z.string().trim().max(2000).nullable().optional(),
});

/**
 * An allocation that differs from the recommendation requires a reason; the
 * service refuses without one, so an override is always accounted for.
 */
export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, Schema);
  await allocateCompensation(actor, params.participantId as string, {
    bp: body.bp,
    rationale: body.rationale ?? null,
  });
  return { ok: true };
});
