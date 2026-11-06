import { handler, parseBody } from '@/server/api';
import { JobTitlePatchSchema } from '@/server/validation/admin';
import { updateJobTitle } from '@/server/services/catalog';

export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, JobTitlePatchSchema);
  await updateJobTitle(actor, params.id as string, body);
  return { ok: true };
});
