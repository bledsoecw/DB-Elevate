import { handler } from '@/server/api';
import { sendCycleReminders } from '@/server/services/cycles';

/** Idempotent per assignment per day, however often it is pressed. */
export const POST = handler(async ({ actor, params }) => sendCycleReminders(actor, params.id as string));
