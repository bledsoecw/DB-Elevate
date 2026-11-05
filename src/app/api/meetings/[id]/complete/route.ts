import { handler, parseBody } from '@/server/api';
import { CompleteMeetingSchema } from '@/server/validation/meetings';
import { completeMeeting } from '@/server/services/meetings';

/** Completing carries unfinished agenda items into the next meeting. */
export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, CompleteMeetingSchema);
  return completeMeeting(actor, params.id as string, body);
});
