import { handler, parseBody } from '@/server/api';
import { ImportValidateSchema } from '@/server/validation/people';
import { validateImportBatch } from '@/server/services/employee-import';

/** Stage 3: classify every row. Still writes nothing to the employee tables. */
export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, ImportValidateSchema);
  return validateImportBatch(actor, params.id as string, body.mapping);
});
