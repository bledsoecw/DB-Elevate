import { handler } from '@/server/api';
import { submitCompensationAllocations } from '@/server/services/compensation';

/** Where the budget ceiling is enforced; the refusal says by how much. */
export const POST = handler(async ({ actor, params }) =>
  submitCompensationAllocations(actor, params.id as string),
);
