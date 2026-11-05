import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { Id } from '@/server/validation/common';
import { CalibrationDecisionSchema } from '@/server/validation/admin';
import { decideCalibration, revertCalibration } from '@/server/services/calibration';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, CalibrationDecisionSchema);
  await decideCalibration(
    actor,
    params.id as string,
    body.participantId,
    body.finalScore,
    body.rationale,
  );
  return { ok: true };
});

/** Clears a recorded decision so the calculated score applies again. */
export const DELETE = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, z.object({ participantId: Id }));
  await revertCalibration(actor, params.id as string, body.participantId);
  return { ok: true };
});
