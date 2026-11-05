import { handler } from '@/server/api';
import { launchCompensationCycle } from '@/server/services/compensation';

export const POST = handler(async ({ actor, params }) =>
  launchCompensationCycle(actor, params.id as string),
);
