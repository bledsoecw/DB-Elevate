import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { finalizeCalibrationSession } from '@/server/services/calibration';

const Schema = z.object({ notes: z.string().trim().max(4000).nullable().optional() });

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, Schema);
  return finalizeCalibrationSession(actor, params.id as string, body.notes ?? null);
});
