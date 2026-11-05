import { handler } from '@/server/api';
import { launchCycle } from '@/server/services/cycles';

/**
 * Launching takes the organizational snapshot for every participant and
 * creates the assignments. It cannot be undone.
 */
export const POST = handler(async ({ actor, params }) => launchCycle(actor, params.id as string));
