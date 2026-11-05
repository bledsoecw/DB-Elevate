import { handler, parseBody } from '@/server/api';
import { NoteSchema } from '@/server/validation/meetings';
import { saveNote } from '@/server/services/meetings';

/** Shared or private. A private note is readable by its author alone. */
export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, NoteSchema);
  const note = await saveNote(actor, params.id as string, body);
  return { id: note.id, visibility: note.visibility };
});
