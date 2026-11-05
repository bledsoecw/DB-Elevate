import { handler, parseBody } from '@/server/api';
import { DuplicateSchema } from '@/server/validation/admin';
import { duplicateTemplate } from '@/server/services/templates';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, DuplicateSchema);
  const created = await duplicateTemplate(actor, params.id as string, body.versionId, body.name);
  return { id: created.id };
});
