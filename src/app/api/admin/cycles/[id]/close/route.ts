import { handler } from '@/server/api';
import { closeCycle } from '@/server/services/cycles';

export const POST = handler(async ({ actor, params }) => closeCycle(actor, params.id as string));
