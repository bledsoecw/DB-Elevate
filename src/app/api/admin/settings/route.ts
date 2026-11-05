import { handler, parseBody } from '@/server/api';
import { OrgSettingsSchema } from '@/server/validation/admin';
import { updateOrgSettings } from '@/server/services/admin';

export const PATCH = handler(async ({ actor, request }) => {
  const body = await parseBody(request, OrgSettingsSchema);
  const { changed } = await updateOrgSettings(actor, body);
  return { changed: changed.map((c) => c.field) };
});
