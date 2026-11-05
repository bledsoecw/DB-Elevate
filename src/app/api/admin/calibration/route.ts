import { handler, parseBody } from '@/server/api';
import { CalibrationSessionSchema } from '@/server/validation/admin';
import { createCalibrationSession } from '@/server/services/calibration';

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, CalibrationSessionSchema);
  const session = await createCalibrationSession(actor, body);
  return { id: session.id };
});
