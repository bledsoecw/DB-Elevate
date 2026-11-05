import { handler, parseBody } from '@/server/api';
import { ActionItemPatchSchema } from '@/server/validation/meetings';
import { updateActionItem } from '@/server/services/meetings';

export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, ActionItemPatchSchema);
  await updateActionItem(actor, params.id as string, body);
  return { ok: true };
});
