import { handler, parseBody } from '@/server/api';
import { TemplateSchema } from '@/server/validation/admin';
import { archiveTemplate, saveTemplateVersion } from '@/server/services/templates';
import { ValidationError } from '@/server/errors';

/**
 * Saving an edit. If the target version is published the service forks it, so
 * the response says which version the caller is now looking at.
 */
export const PATCH = handler(async ({ actor, request, params }) => {
  const url = new URL(request.url);
  const versionId = url.searchParams.get('version');
  if (!versionId) throw new ValidationError('Specify which version is being edited.');
  const body = await parseBody(request, TemplateSchema);
  return saveTemplateVersion(actor, params.id as string, versionId, body, body.changeNote);
});

export const DELETE = handler(async ({ actor, params }) => {
  await archiveTemplate(actor, params.id as string);
  return { ok: true };
});
