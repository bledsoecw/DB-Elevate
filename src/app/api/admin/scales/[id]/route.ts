import { handler, parseBody } from '@/server/api';
import { RatingScalePatchSchema } from '@/server/validation/admin';
import { updateRatingScale } from '@/server/services/catalog';

/**
 * A scale used by a published template version is frozen; the service throws
 * 409 with an explanation rather than silently rewriting history.
 */
export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, RatingScalePatchSchema);
  await updateRatingScale(actor, params.id as string, body);
  return { ok: true };
});
