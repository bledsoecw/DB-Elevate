import { handler, parseBody } from '@/server/api';
import { FeedbackSchema } from '@/server/validation/feedback';
import { createFeedback } from '@/server/services/feedback';

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, FeedbackSchema);
  const item = await createFeedback(actor, body);
  return { id: item.id };
});
