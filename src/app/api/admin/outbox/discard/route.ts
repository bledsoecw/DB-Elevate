import { handler } from '@/server/api';
import { discardQueuedEmail } from '@/server/services/admin';

/** Marks queued messages suppressed. Never claims they were delivered. */
export const POST = handler(async ({ actor }) => discardQueuedEmail(actor));
