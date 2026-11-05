import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { Id } from '@/server/validation/common';
import { clearBudget, setBudget } from '@/server/services/compensation';

const Schema = z.object({
  ownerEmployeeId: Id,
  poolMinor: z.number().int().min(0).max(1_000_000_000_00),
});

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, Schema);
  await setBudget(actor, params.id as string, body.ownerEmployeeId, body.poolMinor);
  return { ok: true };
});

/**
 * Removes a budget, restoring "no ceiling". Deliberately distinct from setting
 * it to zero, which is a ceiling of zero.
 */
export const DELETE = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, z.object({ ownerEmployeeId: Id }));
  await clearBudget(actor, params.id as string, body.ownerEmployeeId);
  return { ok: true };
});
