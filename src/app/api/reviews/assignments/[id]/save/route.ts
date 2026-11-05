import { handler, parseBody } from '@/server/api';
import { SaveDraftSchema } from '@/server/validation/reviews';
import { saveDraft } from '@/server/services/reviews';

/** Autosave. Returns the server's timestamp so the UI shows a real save time. */
export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, SaveDraftSchema);
  const result = await saveDraft(actor, params.id as string, body.answers);
  return { savedAt: result.savedAt.toISOString(), status: result.status };
});
