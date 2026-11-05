import { handler, parseBody } from '@/server/api';
import { CalibrationEntrySchema } from '@/server/validation/admin';
import { proposeCalibration } from '@/server/services/calibration';

/**
 * A proposal is recorded on the session only. It is deliberately not applied
 * to the participant — a number nobody ratified must not reach a review.
 */
export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, CalibrationEntrySchema);
  await proposeCalibration(
    actor,
    params.id as string,
    body.participantId,
    body.proposedScore ?? null,
    body.rationale ?? null,
  );
  return { ok: true };
});
