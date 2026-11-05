import { handler, parseBody } from '@/server/api';
import { AgendaSchema } from '@/server/validation/meetings';
import { addAgendaItem } from '@/server/services/meetings';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, AgendaSchema);
  const item = await addAgendaItem(actor, params.id as string, body);
  return { id: item.id };
});
