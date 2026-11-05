import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { deletePlanAction, setActionStatus } from '@/server/services/development';

const Schema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
});

/**
 * Recording progress. Available to the employee on their own plan, including a
 * restricted improvement plan — they cannot change its terms but must be able
 * to show they have met them. Cancelling is a change to the terms, so the
 * service refuses it for the subject alone.
 */
export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, Schema);
  await setActionStatus(actor, params.id as string, params.actionId as string, body.status);
  return { ok: true };
});

export const DELETE = handler(async ({ actor, params }) => {
  await deletePlanAction(actor, params.id as string, params.actionId as string);
  return { ok: true };
});
