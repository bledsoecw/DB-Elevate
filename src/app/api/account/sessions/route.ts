import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { revokeOtherSessions, revokeOwnSession } from '@/server/services/account';

const Schema = z.object({ sessionId: z.string().min(1).optional() });

/** Ends one of the caller's own sessions, or all but the current one. */
export const DELETE = handler(async ({ actor, request }) => {
  const body = await parseBody(request, Schema);
  if (body.sessionId) {
    await revokeOwnSession(actor, body.sessionId);
    return { ended: 1 };
  }
  return revokeOtherSessions(actor);
});
