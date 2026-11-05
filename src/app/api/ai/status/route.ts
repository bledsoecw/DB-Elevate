import { handler } from '@/server/api';
import { resolveAiRuntime } from '@/server/ai/assist';

/**
 * Lets a screen decide whether to offer an AI control at all, and say why not
 * when it does not. Deliberately returns no credential and no provider
 * internals — only whether assistance is available, and the reason if it is
 * not.
 */
export const GET = handler(async ({ actor }) => {
  const runtime = await resolveAiRuntime(actor.orgId);
  return {
    enabled: runtime.enabled,
    provider: runtime.provider,
    local: runtime.local,
    reason: runtime.reason ?? null,
  };
});
