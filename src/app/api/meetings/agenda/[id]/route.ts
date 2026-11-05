import { handler, parseBody } from '@/server/api';
import { AgendaPatchSchema } from '@/server/validation/meetings';
import { deleteAgendaItem, updateAgendaItem } from '@/server/services/meetings';

export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, AgendaPatchSchema);
  await updateAgendaItem(actor, params.id as string, body);
  return { ok: true };
});

export const DELETE = handler(async ({ actor, params }) => {
  await deleteAgendaItem(actor, params.id as string);
  return { ok: true };
});
