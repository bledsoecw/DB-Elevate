import { handler, parseBody } from '@/server/api';
import { RecognitionValuePatchSchema } from '@/server/validation/admin';
import { retireRecognitionValue, updateRecognitionValue } from '@/server/services/catalog';

export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, RecognitionValuePatchSchema);
  await updateRecognitionValue(actor, params.id as string, body);
  return { ok: true };
});

export const DELETE = handler(async ({ actor, params }) => {
  return retireRecognitionValue(actor, params.id as string);
});
