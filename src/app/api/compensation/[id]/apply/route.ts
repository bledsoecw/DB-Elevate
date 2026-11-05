import { handler } from '@/server/api';
import { applyCompensationCycle } from '@/server/services/compensation';

/**
 * Writes approved increases into pay history. Separate from approval because
 * approving says the number is right; applying changes what somebody is paid.
 */
export const POST = handler(async ({ actor, params }) =>
  applyCompensationCycle(actor, params.id as string),
);
