import { handler, parseBody } from '@/server/api';
import { FeedbackRequestSchema } from '@/server/validation/feedback';
import { requestFeedback } from '@/server/services/feedback';

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, FeedbackRequestSchema);
  const created = await requestFeedback(actor, body);
  return { id: created.id };
});
