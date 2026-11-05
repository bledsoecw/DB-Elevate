import { handler } from '@/server/api';
import { launchSurvey } from '@/server/services/surveys';

/** Fixes the mode and sends the invitations. Cannot be undone. */
export const POST = handler(async ({ actor, params }) => launchSurvey(actor, params.id as string));
