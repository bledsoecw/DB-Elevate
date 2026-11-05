import { handler, parseBody } from '@/server/api';
import { AiSettingsSchema, updateAiSettings } from '@/server/services/admin';

/**
 * Enabling a paid provider is refused here unless the server environment says
 * the spend has been approved. The screen explains it; this is where it holds.
 */
export const PATCH = handler(async ({ actor, request }) => {
  const body = await parseBody(request, AiSettingsSchema);
  const org = await updateAiSettings(actor, body);
  return { aiEnabled: org.aiEnabled, aiProvider: org.aiProvider };
});
