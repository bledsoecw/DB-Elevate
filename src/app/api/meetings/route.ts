import { handler, parseBody } from '@/server/api';
import { MeetingSchema } from '@/server/validation/meetings';
import { createMeeting } from '@/server/services/meetings';

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, MeetingSchema);
  const meeting = await createMeeting(actor, body);
  return { id: meeting.id };
});
