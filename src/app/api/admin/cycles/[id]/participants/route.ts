import { handler, parseBody } from '@/server/api';
import { ParticipantsSchema } from '@/server/validation/admin';
import { setParticipants } from '@/server/services/cycles';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, ParticipantsSchema);
  return setParticipants(actor, params.id as string, body.employeeIds);
});
