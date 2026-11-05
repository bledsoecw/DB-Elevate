import { handler, parseBody } from '@/server/api';
import { RecognitionValueSchema } from '@/server/validation/admin';
import { createRecognitionValue, listRecognitionValues } from '@/server/services/catalog';

export const GET = handler(async ({ actor }) => {
  const values = await listRecognitionValues(actor);
  return { values };
});

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, RecognitionValueSchema);
  const value = await createRecognitionValue(actor, body);
  return { id: value.id };
});
