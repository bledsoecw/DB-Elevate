import { handler, parseBody } from '@/server/api';
import { SubmitSchema } from '@/server/validation/reviews';
import { submitAssignment } from '@/server/services/reviews';

/**
 * Submits a review. Saves whatever was on screen first, so a validation
 * failure never costs the reviewer their work.
 */
export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, SubmitSchema);
  return submitAssignment(actor, params.id as string, body.answers);
});
