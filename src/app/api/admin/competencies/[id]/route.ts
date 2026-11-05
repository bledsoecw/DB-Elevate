import { handler, parseBody } from '@/server/api';
import { CompetencyPatchSchema } from '@/server/validation/admin';
import { getCompetency, retireCompetency, updateCompetency } from '@/server/services/catalog';

export const GET = handler(async ({ actor, params }) => {
  const competency = await getCompetency(actor, params.id as string);
  return { competency };
});

export const PATCH = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, CompetencyPatchSchema);
  await updateCompetency(actor, params.id as string, body);
  return { ok: true };
});

/**
 * Retires rather than deletes when anything references the competency. The
 * response says which happened so the UI can tell the truth about it.
 */
export const DELETE = handler(async ({ actor, params }) => {
  return retireCompetency(actor, params.id as string);
});
