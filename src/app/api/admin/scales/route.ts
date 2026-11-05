import { handler, parseBody } from '@/server/api';
import { RatingScaleSchema } from '@/server/validation/admin';
import { createRatingScale, listRatingScales } from '@/server/services/catalog';

export const GET = handler(async ({ actor }) => {
  const scales = await listRatingScales(actor);
  return { scales };
});

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, RatingScaleSchema);
  const scale = await createRatingScale(actor, body);
  return { id: scale.id };
});
