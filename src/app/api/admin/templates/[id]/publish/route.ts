import { handler } from '@/server/api';
import { publishVersion, unpublishVersion } from '@/server/services/templates';
import { ValidationError } from '@/server/errors';

export const POST = handler(async ({ actor, request, params }) => {
  const url = new URL(request.url);
  const versionId = url.searchParams.get('version');
  if (!versionId) throw new ValidationError('Specify which version to publish.');
  await publishVersion(actor, params.id as string, versionId);
  return { ok: true };
});

export const DELETE = handler(async ({ actor, request, params }) => {
  const url = new URL(request.url);
  const versionId = url.searchParams.get('version');
  if (!versionId) throw new ValidationError('Specify which version to unpublish.');
  await unpublishVersion(actor, params.id as string, versionId);
  return { ok: true };
});
