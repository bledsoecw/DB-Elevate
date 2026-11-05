import { handler } from '@/server/api';
import { getFormOptions } from '@/server/services/people';

/** Picker options for people forms. Names and titles only — no personal data. */
export const GET = handler(async ({ actor }) => getFormOptions(actor.orgId));
