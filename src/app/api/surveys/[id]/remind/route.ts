import { handler } from '@/server/api';
import { sendSurveyReminders } from '@/server/services/surveys';

/** Idempotent per person per day, however many times it is pressed. */
export const POST = handler(async ({ actor, params }) => sendSurveyReminders(actor, params.id as string));
