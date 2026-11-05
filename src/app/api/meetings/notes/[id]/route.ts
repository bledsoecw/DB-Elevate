import { handler } from '@/server/api';
import { deleteNote } from '@/server/services/meetings';

export const DELETE = handler(async ({ actor, params }) => {
  await deleteNote(actor, params.id as string);
  return { ok: true };
});
