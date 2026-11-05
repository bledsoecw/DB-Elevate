import { handler, parseBody } from '@/server/api';
import { ImportCommitSchema } from '@/server/validation/people';
import { commitImportBatch } from '@/server/services/employee-import';

/** Stage 4: apply exactly what the preview showed. */
export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, ImportCommitSchema);
  return commitImportBatch(actor, params.id as string, body);
});
