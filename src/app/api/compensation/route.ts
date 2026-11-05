import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { Id, IsoDate } from '@/server/validation/common';
import { createCompensationCycle } from '@/server/services/compensation';

const Schema = z.object({
  name: z.string().trim().min(3, 'Name the cycle.').max(200),
  effectiveDate: z.string().trim().min(1),
  dueAt: IsoDate.nullable().optional(),
  reviewCycleId: Id.nullable().optional(),
  /** Integer minor units — see src/lib/money.ts. */
  totalPoolMinor: z.number().int().min(0).max(1_000_000_000_00),
  currency: z.string().trim().length(3).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  employeeIds: z.array(Id).max(5000).optional(),
});

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, Schema);
  const result = await createCompensationCycle(actor, body);
  return { id: result.cycle.id, included: result.included, skippedNoPay: result.skippedNoPay };
});
