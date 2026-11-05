import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { removeSalaryBand, setSalaryBand } from '@/server/services/compensation';

/** Integer minor units — see src/lib/money.ts. */
const Minor = z.number().int().min(0).max(1_000_000_000_00);

const Schema = z.object({
  minMinor: Minor,
  midMinor: Minor.nullable().optional(),
  maxMinor: Minor,
  currency: z.string().trim().length(3).optional(),
});

export const PUT = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, Schema);
  await setSalaryBand(actor, params.jobTitleId as string, body);
  return { ok: true };
});

export const DELETE = handler(async ({ actor, params }) => {
  await removeSalaryBand(actor, params.jobTitleId as string);
  return { ok: true };
});
