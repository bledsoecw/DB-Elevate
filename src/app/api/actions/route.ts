import { handler, parseBody } from '@/server/api';
import { ActionItemSchema } from '@/server/validation/meetings';
import { createActionItem } from '@/server/services/meetings';

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, ActionItemSchema);
  const item = await createActionItem(actor, body);
  return { id: item.id };
});
