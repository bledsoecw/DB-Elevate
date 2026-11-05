import { handler, parseBody } from '@/server/api';
import { ImportCreateSchema } from '@/server/validation/people';
import { createImportBatch } from '@/server/services/employee-import';

/** Stage 1: parse the file and suggest a column mapping. Writes nothing. */
export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, ImportCreateSchema);
  return createImportBatch(actor, body.filename, body.csv);
});
