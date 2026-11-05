import { handler, parseBody } from '@/server/api';
import { CompetencyLibraryPatchSchema } from '@/server/validation/admin';
import { updateLibrary } from '@/server/services/catalog';

export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, CompetencyLibraryPatchSchema);
  await updateLibrary(actor, params.id as string, body);
  return { ok: true };
});
